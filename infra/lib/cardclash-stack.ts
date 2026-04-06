import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigwv2int from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as path from 'path';

// Configure these via environment variables or CDK context
const CUSTOM_DOMAIN = process.env.CUSTOM_DOMAIN || 'your-domain.example.com';
const CERT_ARN = process.env.CERT_ARN || '';

export class CardClashStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ── DynamoDB: records ─────────────────────────────────────────────────────
    const table = new dynamodb.Table(this, 'RecordsTable', {
      tableName: 'cardclash-records',
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN
    });

    // ── DynamoDB: WebSocket connections ───────────────────────────────────────
    const connTable = new dynamodb.Table(this, 'ConnectionsTable', {
      tableName: 'cardclash-connections',
      partitionKey: { name: 'connectionId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',          // auto-expire stale connections
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    // ── Cognito ───────────────────────────────────────────────────────────────
    const userPool = new cognito.UserPool(this, 'AdminPool', {
      userPoolName: 'cardclash-admins',
      selfSignUpEnabled: false,
      signInAliases: { username: true },
      passwordPolicy: { minLength: 8, requireUppercase: false, requireSymbols: false },
      removalPolicy: cdk.RemovalPolicy.RETAIN
    });

    const userPoolClient = new cognito.UserPoolClient(this, 'AdminPoolClient', {
      userPool,
      authFlows: { userPassword: true, userSrp: true },
      generateSecret: false
    });

    // ── Lambda (placeholder env — WS_ENDPOINT filled after WS API is created) ─
    const fn = new lambda.Function(this, 'RecordsHandler', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../backend/lambda')),
      environment: {
        TABLE_NAME: table.tableName,
        CONN_TABLE_NAME: connTable.tableName,
        WS_ENDPOINT: 'PLACEHOLDER' // replaced below via CfnFunction override
      },
      timeout: cdk.Duration.seconds(10)
    });
    table.grantReadWriteData(fn);
    connTable.grantReadWriteData(fn);

    // ── REST API Gateway ──────────────────────────────────────────────────────
    const api = new apigw.RestApi(this, 'RecordsApi', {
      restApiName: 'cardclash-api',
      defaultCorsPreflightOptions: {
        allowOrigins: apigw.Cors.ALL_ORIGINS,
        allowMethods: apigw.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization']
      }
    });

    const cognitoAuth = new apigw.CognitoUserPoolsAuthorizer(this, 'CognitoAuth', {
      cognitoUserPools: [userPool]
    });

    const lambdaInt = new apigw.LambdaIntegration(fn);

    const records = api.root.addResource('records');
    records.addMethod('GET', lambdaInt);
    records.addMethod('POST', lambdaInt, {
      authorizer: cognitoAuth, authorizationType: apigw.AuthorizationType.COGNITO
    });

    const record = records.addResource('{id}');
    record.addMethod('PUT', lambdaInt, {
      authorizer: cognitoAuth, authorizationType: apigw.AuthorizationType.COGNITO
    });
    record.addMethod('DELETE', lambdaInt, {
      authorizer: cognitoAuth, authorizationType: apigw.AuthorizationType.COGNITO
    });

    const live = api.root.addResource('live');
    live.addMethod('GET', lambdaInt);
    live.addMethod('PUT', lambdaInt, {
      authorizer: cognitoAuth, authorizationType: apigw.AuthorizationType.COGNITO
    });
    live.addMethod('DELETE', lambdaInt, {
      authorizer: cognitoAuth, authorizationType: apigw.AuthorizationType.COGNITO
    });

    const checkin = api.root.addResource('checkin');
    checkin.addMethod('GET', lambdaInt);
    checkin.addMethod('POST', lambdaInt);
    checkin.addMethod('PUT', lambdaInt, {
      authorizer: cognitoAuth, authorizationType: apigw.AuthorizationType.COGNITO
    });
    checkin.addMethod('DELETE', lambdaInt, {
      authorizer: cognitoAuth, authorizationType: apigw.AuthorizationType.COGNITO
    });

    // ── WebSocket API Gateway ─────────────────────────────────────────────────
    const wsApi = new apigwv2.WebSocketApi(this, 'LiveWsApi', {
      apiName: 'cardclash-ws',
      connectRouteOptions: {
        integration: new apigwv2int.WebSocketLambdaIntegration('WsConnect', fn)
      },
      disconnectRouteOptions: {
        integration: new apigwv2int.WebSocketLambdaIntegration('WsDisconnect', fn)
      },
      defaultRouteOptions: {
        integration: new apigwv2int.WebSocketLambdaIntegration('WsDefault', fn)
      }
    });

    const wsStage = new apigwv2.WebSocketStage(this, 'LiveWsStage', {
      webSocketApi: wsApi,
      stageName: 'prod',
      autoDeploy: true
    });

    // Grant Lambda permission to post back to WebSocket connections
    fn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['execute-api:ManageConnections'],
      resources: [`arn:aws:execute-api:${this.region}:${this.account}:${wsApi.apiId}/${wsStage.stageName}/POST/@connections/*`]
    }));

    // Patch WS_ENDPOINT env var now that we have the URL
    const cfnFn = fn.node.defaultChild as lambda.CfnFunction;
    cfnFn.addPropertyOverride('Environment.Variables.WS_ENDPOINT', wsStage.callbackUrl);

    // ── S3 Bucket ─────────────────────────────────────────────────────────────
    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true
    });

    // ── CloudFront ────────────────────────────────────────────────────────────
    const cert = acm.Certificate.fromCertificateArn(this, 'SiteCert', CERT_ARN);

    const distribution = new cloudfront.Distribution(this, 'SiteDistribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED
      },
      domainNames: [CUSTOM_DOMAIN],
      certificate: cert,
      defaultRootObject: 'index.html',
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html' },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html' }
      ]
    });

    // ── Deploy frontend with config ───────────────────────────────────────────
    const configContent = [
      'window.APP_CONFIG = {',
      `  userPoolId: "${userPool.userPoolId}",`,
      `  userPoolClientId: "${userPoolClient.userPoolClientId}",`,
      `  apiEndpoint: "${api.url}",`,
      `  wsEndpoint: "${wsStage.url}",`,
      `  region: "${cdk.Stack.of(this).region}"`,
      '};'
    ].join('\n');

    new s3deploy.BucketDeployment(this, 'DeployFrontend', {
      sources: [
        s3deploy.Source.asset(path.join(__dirname, '../../'), {
          exclude: ['infra/**', 'backend/**', '.kiro/**', '.vscode/**', 'node_modules/**', '*.md']
        }),
        s3deploy.Source.data('config.js', configContent)
      ],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ['/*']
    });

    // ── Outputs ───────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'SiteUrl',           { value: `https://${CUSTOM_DOMAIN}` });
    new cdk.CfnOutput(this, 'ApiEndpoint',        { value: api.url });
    new cdk.CfnOutput(this, 'WsEndpoint',         { value: wsStage.url });
    new cdk.CfnOutput(this, 'UserPoolId',         { value: userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId',   { value: userPoolClient.userPoolClientId });
  }
}

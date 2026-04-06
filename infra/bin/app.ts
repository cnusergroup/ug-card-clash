#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CardClashStack } from '../lib/cardclash-stack';

const app = new cdk.App();
new CardClashStack(app, 'CardClashStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION
  }
});

# 部署指南 — AWS Card Clash

## 前置条件

- AWS CLI 已配置（`aws configure`）
- Node.js 18+
- CDK CLI：`npm install -g aws-cdk`

## 一键部署

```bash
# 1. 安装 CDK 依赖
cd infra
npm install

# 2. 首次部署需要 bootstrap（每个账号/区域只需一次）
npx cdk bootstrap

# 3. 部署整套基础设施
npx cdk deploy

# 部署完成后会输出：
# CardClashStack.SiteUrl        = https://xxxx.cloudfront.net
# CardClashStack.ApiEndpoint    = https://xxxx.execute-api.cn-northwest-1.amazonaws.com/prod/
# CardClashStack.UserPoolId     = cn-northwest-1_xxxxxx
# CardClashStack.UserPoolClientId = xxxxxx
```

## 创建管理员账号

```bash
# 替换 YOUR_USER_POOL_ID 为上面输出的 UserPoolId
aws cognito-idp admin-create-user \
  --user-pool-id YOUR_USER_POOL_ID \
  --username admin \
  --temporary-password "YOUR_TEMP_PASSWORD" \
  --region YOUR_REGION
```

首次登录时页面会提示设置新密码。

## 更新前端文件

```bash
cd infra
npx cdk deploy  # 重新部署会自动同步 S3 并刷新 CloudFront 缓存
```

## 销毁资源

```bash
cd infra
npx cdk destroy
```

> DynamoDB 表和 Cognito User Pool 设置了 `RETAIN`，销毁 Stack 后数据不会丢失。

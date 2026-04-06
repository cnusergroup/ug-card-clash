# AWS Card Clash 对战锦标赛官网

AWS Card Clash 线下对战锦标赛的活动官网，包含活动介绍、瑞士轮赛制规则说明、活动日程，以及一个内置的瑞士轮赛程自动规划工具。

## 功能

- **活动介绍** — Card Clash 游戏说明、玩法介绍
- **瑞士轮赛制规则** — 配对原则、积分规则、轮次计算、轮空处理等
- **活动日程** — 时间线展示报名、比赛、颁奖等关键节点
- **瑞士轮赛程工具** — 支持选手管理（单个/批量添加）、自动瑞士轮配对、比赛结果录入、实时积分排名（含布赫兹分）
- **成绩记录管理** — 保存和查看历史赛事成绩（需后端）
- **实时对战直播** — WebSocket 实时推送比赛状态（需后端）
- **现场签到** — 扫码签到功能（需后端）

## 快速开始

### 纯前端使用（无需后端）

直接用浏览器打开 `index.html` 即可使用活动介绍页面和瑞士轮赛程工具。

### 完整部署（含后端）

项目使用 AWS CDK 部署完整基础设施，包括：

- S3 + CloudFront 静态网站托管
- API Gateway + Lambda 后端 API
- WebSocket API 实时通信
- DynamoDB 数据存储
- Cognito 管理员认证

详见 [DEPLOY.md](DEPLOY.md)。

## 部署配置

部署前需设置以下环境变量：

```bash
export CUSTOM_DOMAIN="your-domain.example.com"
export CERT_ARN="arn:aws:acm:us-east-1:YOUR_ACCOUNT_ID:certificate/YOUR_CERT_ID"
```

## 项目结构

```
├── index.html          # 主页（活动介绍 + 瑞士轮工具）
├── styles.css          # 主页样式
├── app.js              # 主页逻辑（粒子动画 + 瑞士轮引擎）
├── auth.js             # Cognito 认证模块
├── records.html/js/css # 成绩记录页面
├── live.html/js/css    # 实时直播页面
├── checkin.html/js/css # 现场签到页面
├── events.js           # 活动管理
├── icons/              # AWS 服务图标
├── backend/lambda/     # Lambda 函数
├── infra/              # CDK 基础设施代码
└── DEPLOY.md           # 部署指南
```

## 技术栈

- 前端：原生 HTML/CSS/JS，无框架依赖
- 后端：AWS Lambda (Node.js 20.x)
- 数据库：Amazon DynamoDB
- 认证：Amazon Cognito
- 托管：Amazon S3 + CloudFront
- 实时通信：API Gateway WebSocket
- 基础设施：AWS CDK (TypeScript)

## License

MIT

# FitRank Team MVP

一个 FitRank Team MVP，用于团队记录体测、饮食摄入、运动消耗，并按周期生成缺口率排行榜。

## 使用方式

数据库模式：

```bash
npm run fitness:server
```

然后访问：

```text
http://127.0.0.1:5174/
```

该模式默认使用 SQLite 保存用户、体测、摄入、运动、小组和挑战数据，数据文件位于：

```text
fitness-api/data/fitness.sqlite
```

静态预览模式：

```text
fitness-saas/index.html
```

静态预览模式没有后端，只会使用浏览器 `localStorage`。正式试用请使用数据库模式。

## 免费部署建议

推荐用 Render 免费 Web Service 跑 Node 后端，再绑定 Neon 免费 Postgres 作为持久数据库。

1. 在 Neon 创建一个免费 Postgres 项目，复制连接串。
2. 在 Render 新建 Blueprint 或 Web Service，连接本仓库。
3. 使用仓库里的 `render.yaml`，或者手动配置：
   - Build Command: `npm install`
   - Start Command: `npm run fitness:server`
   - Environment: `NODE_VERSION=24`
   - Environment: `DATABASE_URL=<Neon 连接串>`

线上设置了 `DATABASE_URL` 后，服务会自动创建 Postgres 表，不再使用会随部署丢失的本地 SQLite 文件。

Netlify 站点也支持同样的数据库模式：只要给 `fitness-saas` 配上 `DATABASE_URL`，`/api/state` 会优先写 Postgres，并在首次启动时从旧的 Blob 状态自动迁移。

## 已支持

- 每个用户独立上传体测信息：体重、体脂、腰围、备注。
- 注册本地用户并进入个人工作台。
- 拍照记录摄入食品，并填写餐次和热量。
- 上传 Apple 运动截图，或手动填写运动项目、时长和消耗大卡。
- 按天、周、月、季度生成小组排行榜。
- 创建健身小组、搜索已有用户加入，也可以快速添加队友档案和当天数据。
- 小组比拼视图按周期展示成员摄入、运动、热量缺口和缺口率。
- 激励小游戏：每日挑战抽签、完成挑战得分、热量护城河反馈。
- 后端数据库持久化：本地 SQLite，线上 Postgres；前端会优先同步 `/api/state`，静态环境下才回退到 `localStorage`。

## 后续 SaaS 化方向

- 接入账号系统和真实组织租户。
- 引入图片 OCR 或大模型识别食品/Apple 运动截图。
- 增加管理员后台、团队邀请、赛季规则和导出报表。

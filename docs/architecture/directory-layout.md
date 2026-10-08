# 思维工坊目录结构说明

更新日期：2026年10月8日  
开发根目录：F:/MW/main  
现行基线：[产品 V1.1](../product/product-spec-v1.1.md)和[技术文档入口](README.md)。

CloudBase 已确定为云平台。MW03 已建立本地工程骨架（根 package.json、工作区、typecheck/test/build）。未创建云资源、未部署。

## 现有目录树

```text
F:/MW/main/
├── README.md
├── package.json
├── package-lock.json
├── tsconfig.base.json
├── .env.example
├── .gitignore
├── docs/
│   ├── product/
│   │   ├── product-spec-v1.1.md
│   │   └── product-spec-v1.0.md
│   ├── architecture/
│   │   ├── README.md
│   │   ├── directory-layout.md
│   │   ├── implementation-baseline-v1.0.md
│   │   ├── technical-design-v1.0.md
│   │   ├── data-model-v1.0.md
│   │   └── consistency-v1.0.md
│   ├── api/
│   │   └── api-contract-v1.0.md
│   ├── operations/
│   │   ├── payment-v1.0.md
│   │   └── cloudbase-deployment-v1.0.md
│   ├── testing/
│   │   └── acceptance-plan-v1.0.md
│   ├── decisions/
│   │   └── 20261003-product-update.md
│   ├── development/
│   │   └── handbook-v0.1/
│   │       ├── README.md
│   │       ├── 02-roadmap.md
│   │       ├── 07-progress.md
│   │       └── first-batch/
│   │           ├── mw01-baseline.md
│   │           └── results/
│   └── design/
├── apps/
│   ├── miniprogram/
│   └── admin/
├── services/
│   └── api/
├── packages/
│   └── shared/
├── infra/
│   └── cloudbase/
├── assets/
│   ├── brand/
│   └── badges/
├── samples/
│   ├── contracts/
│   ├── imports/
│   └── fixtures/
├── scripts/          # 共享 JS 生成、小程序构建与导入检查（MW03）
└── tests/
    ├── integration/
    └── e2e/
```

开发任务与状态入口分别为 [任务总览](../development/handbook-v0.1/02-roadmap.md)和[实际进度](../development/handbook-v0.1/07-progress.md)。`first-batch/results` 已有 MW01—MW03 结果文件，空目录不再表示未执行。

产品 V1.0 保留历史原文，V1.1 是当前产品说明。技术文件自身使用 V1.0，不表示沿用旧产品规则。空目录在未来 Git 仓库中不会自动保留，实际开发时再纳入文件，不为每个目录制造占位文件。

## 目录职责

| 路径 | 用途 |
| --- | --- |
| docs/product | 现行产品与保留的历史版本 |
| docs/architecture | 技术总览、数据、一致性、目录与阅读入口 |
| docs/design | 页面原型、视觉规范、交互和页面状态 |
| docs/api | 小程序和后台接口契约及错误码 |
| docs/testing | 验收计划与未来实际结果，二者分别标记 |
| docs/operations | 支付、CloudBase 环境、发布、对账、备份恢复 |
| docs/decisions | 已确认决定、设计补充、影响与版本 |
| docs/development/handbook-v0.1 | 任务总览、实际进度及逐项说明；results 仅保存真实执行结果 |
| apps/miniprogram | 原生微信小程序源码 |
| apps/admin | Vue 3 与 TypeScript 网页后台 |
| services/api | 云函数入口、业务模块与 CloudBase/微信支付适配器 |
| packages/shared | 纯类型、校验与错误码，不存答案和密钥 |
| infra/cloudbase | 待创建的部署描述、集合索引与安全规则模板 |
| assets | 品牌及勋章原稿和授权说明 |
| samples/contracts | MW01 建立的虚构接口样例与字段说明，供契约对照 |
| samples/imports | 虚构 CSV 模板与导入示例，开发阶段建立 |
| samples/fixtures | 隔离测试数据，不放真实会员或订单 |
| scripts | 构建、校验、有限初始化及迁移 |
| tests | 集成和端到端验证；单元测试可随模块存放 |

## 源码与配置后续落位

services/api/src/entrypoints 下分别建立 mw-public、mw-member、mw-admin、mw-upload、mw-pay-hook、mw-jobs 入口；共享逻辑在 src/modules，SDK 适配在 src/adapters。每个部署包独立包含必要运行依赖，不把整个开发目录上传。

infra/cloudbase 下建立按环境参数化的部署描述、database-collections、database-indexes、security-rules 等文件，实际格式按锁定的 CLI/SDK 版本确定。本次不生成带未知环境 ID 的可执行部署配置。

正式题库、答题数据、订单及题目图片属于 CloudBase 数据与私有存储，不进入 samples 或小程序静态包。品牌静态资源可以随前端构建发布，解析图片不能混入公开资源。

## 资料与版本管理

已在 F:/MW/main 初始化 Git，基线提交为 `8294079`；`main` 已推送至 `https://github.com/qiandacegood/mw.git` 并跟踪 `origin/main`。现有 .gitignore 排除常见依赖、构建结果、环境秘密、运行数据和备份，不能替代提交前检查。

.env.example 仅在需要时列变量名与无效占位值。真实环境、支付秘密、生产日志、会员与订单明细均不得写入源码。后续修改需同步现行产品、技术和决定记录，历史文件继续保留历史语义。

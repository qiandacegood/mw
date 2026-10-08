# 页面地图

日期：2026年10月8日  
走查：[小程序原型](prototypes/miniprogram.html) · [后台原型](prototypes/admin.html)

## 1 小程序

```text
启动
 ├─ 公开浏览（游客）
 │   ├─ 首页 home
 │   ├─ 分类 category → 试卷列表 paper-list → 试卷详情 paper-detail
 │   └─ 排行榜 ranking（未登录可看前百，无本人名次）
 ├─ 注册 register（协议未预勾选）
 └─ 已登录
     ├─ 首页 home（继续练习 / 总分等级）
     ├─ 分类 category → paper-list → paper-detail
     │    ├─ 开始 / 继续 → 答题 quiz ↔ 答题卡 answer-card
     │    ├─ 交卷 → 结果 result → 解析 analysis
     │    └─ VIP 卷无权限 → VIP 中心 vip
     ├─ 排行榜 ranking（四维；分类榜选三级）
     └─ 我的 me
          ├─ 资料 profile
          ├─ 成长 / 勋章（本页区块）
          ├─ VIP 中心 vip → 收银台提示 checkout
          ├─ 订单 orders → 订单详情 order-detail
          └─ 协议 / 客服 / 注销入口（占位文案）
```

底部四项固定：首页、分类、排行榜、我的。答题、结果、VIP、订单为栈页面，不替换 Tab。

| 页面 ID | 标题 | Tab | 主要去向 |
| --- | --- | --- | --- |
| home | 首页 | 首页 | 分类、试卷详情、继续答题、注册 |
| category | 分类 | 分类 | 子级分类、试卷列表 |
| paper-list | 试卷列表 | 分类 | 试卷详情 |
| paper-detail | 试卷详情 | — | 答题、替换草稿确认、VIP、注册 |
| quiz | 答题 | — | 答题卡、保存状态、交卷确认 |
| answer-card | 答题卡 | — | 跳题、交卷 |
| result | 结果 | — | 解析、再练、首页 |
| analysis | 解析 | — | 只看错题、返回结果 |
| ranking | 排行榜 | 排行榜 | 规则说明、开启参与 |
| vip | VIP 中心 | — | 下单、订单 |
| checkout | 确认支付结果 | — | 订单详情、刷新 |
| orders | 我的订单 | — | 订单详情 |
| order-detail | 订单详情 | — | 刷新、关单、售后说明 |
| me | 我的 | 我的 | 资料、VIP、订单、注册 |
| register | 注册 | — | 首页 / 原目标页 |
| profile | 个人资料 | — | 我的 |

## 2 管理后台

```text
登录 admin-login
 └─ 工作台 admin-home
      ├─ 类目 admin-categories
      ├─ 题库 admin-questions → 题目编辑
      ├─ 试卷 admin-papers → 预览 / 发布 / 下架 / 撤回
      ├─ 导入 admin-import
      ├─ 会员 admin-members
      ├─ 订单 admin-orders → 退款审核 / 执行（按角色）
      ├─ 成长 admin-growth
      ├─ 榜单治理 admin-ranking
      ├─ 反馈统计 admin-ops
      └─ 管理员 admin-users（仅 super）
```

| 页面 ID | 最低角色 | 说明 |
| --- | --- | --- |
| admin-login | 无 | CloudBase 账号密码；无公开注册 |
| admin-home | 已启用后台账号 | 维护开关摘要、待处理任务 |
| admin-categories | content | 树、排序；改父级走预览 |
| admin-questions | content | 三种题型、图片、版本 |
| admin-papers | content | 组卷、预览、发布 |
| admin-import | content | CSV 校验预览提交 |
| admin-members | operations | 无支付密钥；题库角色不可见订单明细 |
| admin-orders | operations | 查询与核对；退款执行仅 super |
| admin-growth | super | 门槛预览发布 |
| admin-ranking | super | 禁榜、快照状态 |
| admin-ops | operations | 反馈与基础统计 |
| admin-users | super | 角色与停用 |

## 3 不在首版地图中的页面

独立错题本、复杂搜索、历史赛季、代币充值、邀请返佣、社区聊天。找题依赖类目 / 难度 / 是否做过筛选，以及解析页“只看错题”。

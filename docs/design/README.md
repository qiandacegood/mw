# 思维工坊页面设计入口

日期：2026年10月8日（MW02 建）· 2026年10月15日（MW-UI01 更新）  
任务：MW02 页面原型与视觉规范；MW-UI01 UI 规范定稿与答题页样板  
依据：[产品 V1.1](../product/product-spec-v1.1.md)、[实施基线](../architecture/implementation-baseline-v1.0.md)  
状态：视觉规范已按 MW-UI01 定稿为实施基线（品牌色与组件映射以 [visual-spec.md](visual-spec.md)、[tdesign-component-map.md](tdesign-component-map.md) 为准）；答题页样板已由用户手点验证并通过（2026-10-15）。HTML 原型仍为走查稿，与小程序实现不一致时以小程序 + 实施基线为准。

## 阅读顺序

1. [页面地图](sitemap.md)
2. [视觉规范（MW-UI01 定稿）](visual-spec.md)
3. [TDesign 组件映射与接入约定](tdesign-component-map.md)
4. [关键交互](interactions.md)
5. [状态矩阵](state-matrix.md)
6. [答题页样板预览与手点说明](prototypes/quiz-tdesign-review.md)
7. [走查原型入口](prototypes/index.html)

## 覆盖范围

- 小程序四导航：首页、分类、排行榜、我的。
- 答题、答题卡、结果、解析。
- 排行榜四维与本人名次。
- VIP 购买、订单、开通中。
- 后台登录及类目、题库、组卷、导入、会员、订单、成长、榜单治理、反馈统计。
- 角色：游客、免费会员、有效 VIP、过期 VIP。
- 页面状态：默认、空白、加载、错误、处理中。

## 明确不是需求的内容

- 主色 `#2B6CB0` 已在 MW-UI01 定为品牌主色（不再按占位处理）；几何标志与示例价 `¥99.00`（9900 分）仍可在正式发布前替换。
- 本目录是静态走查稿，不是与正式应用平行的工程。
- 不包含真实题库、真实会员或可用支付参数。

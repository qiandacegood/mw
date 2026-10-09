# 思维工坊开发资料入口

思维工坊是通过单选、多选、判断题及解析进行思维练习的微信小程序，包含成长等级、勋章、有效期 VIP 在线购买和多维排行榜。

开发根目录：F:/MW/main  
更新时间：2026年10月9日  
当前状态：MW01—MW03、MW05、MW06、MW07、MW08、MW09、MW10、MW11 已完成；MW04 部分完成；MW12 部分完成（导入机制已落地，题库批 leftover 已按精确 id 清到 0，本份 knownIds 无试卷 id）。MW04：mw-test 正式入口、admin_users 与 jobs 基础已部署，锁定 Nodejs20.19 与 SDK；P04/P05/P06 已闭合，P08 已补记 jobs/audit_logs、MW09 的 categories、MW10 的 questions、MW11 的 papers 两条指定索引与 MW12 的 import_rows 指定索引，其余未来索引仍 PARTIAL；P10 仍 PARTIAL。MW07 仅为技术样例：未真实扣款、未 iOS 现网、未购买闭环，未标 A14/A20/T20/T26 通过。没有生产环境、没有真实支付。

> **2026-10-07 目录生效记录**：本轮按发起人决定，思维工坊主开发根为 **`F:/MW/main`**；`F:/MW` 仅作为容器父目录保留入口说明（`F:/MW/ENTRY.md`）。本次只做目录落位与入口路径说明调整，不改产品范围、不初始化源码工程、不创建云资源。历史文档中写为 `F:/MW` 的段落为**当时的原始记录，保留原文不改写**。

## 当前入口

1. [产品说明书 V1.1](docs/product/product-spec-v1.1.md)：最多三级可维护类目，免费及 VIP 试卷统一排行，CloudBase 云平台。
2. [首版任务总览](docs/development/handbook-v0.1/02-roadmap.md)：30 项任务、6 阶段及里程碑，后续按任务逐项开发。
3. [实际进度](docs/development/handbook-v0.1/07-progress.md)：唯一开发执行状态入口。
4. [技术文档入口](docs/architecture/README.md)：架构、数据与索引、接口、一致性、支付、部署运维及验收。
5. [目录结构说明](docs/architecture/directory-layout.md)：源码及资料落位。
6. [本次需求更新记录](docs/decisions/20261003-product-update.md)：已确认决定与补充设计。

[V1.0 产品说明书](docs/product/product-spec-v1.0.md)只作历史保留，不再作为开发基线。第一版仍必须包含在线支付和四维排行榜；不得用人工开通替代在线购买。

## 下一阶段

下一建议项：MW13 首页与三级分类选卷。本仓库本提交不启动 MW13。MW12 保持部分完成，未标 A21/T16/T17 通过。MW07 已完成（仅技术样例），未标 A14/A20/T20/T26 通过。

真实环境 ID 只存在于本地 `.env`。运营主体、预算和正式售价等按对应阶段确认。没有创建付费升级或接入其他产品的生产数据。

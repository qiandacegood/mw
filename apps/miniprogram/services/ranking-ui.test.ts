import { describe, expect, it } from "vitest";
import {
  boundaryNoticeOf,
  categoryOptionsOf,
  emptyHintOf,
  errorTextOf,
  formatBeijingTime,
  historyGapTextOf,
  meViewOf,
  refreshViewOf,
  rowViewsOf,
  scopeRule,
  staleNoticeOf,
  valueDiffTextOf
} from "./ranking-ui";

describe("MW17 排行榜展示映射", () => {
  it("更新时间按北京时间显示服务端真实时间，不伪造", () => {
    // 2026-10-15T02:00:00Z → 北京时间 10:00:00
    expect(formatBeijingTime("2026-10-15T02:00:00.000Z")).toBe("2026-10-15 10:00:00");
    expect(formatBeijingTime("")).toBe("");
    expect(formatBeijingTime("not-a-time")).toBe("");
  });

  it("刷新状态区分未生成/更新中/更新延迟/已更新", () => {
    const unpublished = refreshViewOf({ status: "unpublished", updatedAt: "" });
    expect(unpublished.tone).toBe("muted");
    expect(unpublished.detail).toContain("还未发布");

    const updating = refreshViewOf({
      status: "updating",
      updatedAt: "2026-10-15T02:00:00.000Z",
      requestedAt: "2026-10-15T02:00:30.000Z",
      pendingMs: 12_000
    });
    expect(updating.label).toBe("更新于 2026-10-15 10:00:00");
    expect(updating.detail).toContain("正在更新");
    expect(updating.tone).toBe("warn");

    const delayed = refreshViewOf({
      status: "delayed",
      updatedAt: "2026-10-15T01:00:00.000Z",
      requestedAt: "2026-10-15T01:59:00.000Z",
      pendingMs: 120_000
    });
    expect(delayed.detail).toContain("更新延迟");
    expect(delayed.detail).toContain("120 秒前");

    const fresh = refreshViewOf({ status: "fresh", updatedAt: "2026-10-15T02:00:00.000Z" });
    expect(fresh.tone).toBe("ok");
    expect(fresh.detail).toBe("");
  });

  it("榜行映射：名次、初始字、分差与本人高亮", () => {
    const rows = rowViewsOf(
      [
        { rank: 1, rankKey: "abc", nickname: "思芽", levelId: "L2", value: 100, valueDiff: null },
        { rank: 3, rankKey: "xyz", nickname: "你", levelId: "L1", value: 80, valueDiff: 20 }
      ],
      "xyz"
    );
    expect(rows[0]?.rankText).toBe("1");
    expect(rows[0]?.isTop).toBe(true);
    expect(rows[0]?.initial).toBe("思");
    expect(rows[0]?.isMine).toBe(false);
    expect(rows[1]?.valueDiffText).toBe("差 20");
    expect(rows[1]?.isMine).toBe(true);
    // 前 3 名为高亮区（并列 1、1、3 时第 3 名同样在前三）
    expect(rows[1]?.isTop).toBe(true);
    expect(rowViewsOf([{ rank: 4, rankKey: "k4", nickname: "丁", value: 10 }], "k4")[0]?.isTop).toBe(false);
  });

  it("名次缺失与空行不计入展示", () => {
    expect(rowViewsOf(undefined, "k")).toEqual([]);
    expect(valueDiffTextOf(null)).toBe("");
    expect(valueDiffTextOf(0)).toBe("");
    expect(valueDiffTextOf(15)).toBe("差 15");
  });

  it("本人区域区分未参与 / 未上榜 / 已上榜，并保留历史缺口说明", () => {
    const notJoined = meViewOf({ participating: false, privateTotalScore: 9 }, "total");
    expect(notJoined.rankText).toBe("未上榜");
    expect(notJoined.valueText).toBe("私人总分 9");
    expect(notJoined.hint).toContain("参与公开排行");

    const joinedNoBoard = meViewOf({ participating: true, onBoard: false, value: 0 }, "total");
    expect(joinedNoBoard.hint).toContain("零分");

    const joinedCategory = meViewOf({ participating: true, onBoard: false, value: 0 }, "category");
    expect(joinedCategory.hint).toContain("类目");

    const onBoard = meViewOf(
      { participating: true, onBoard: true, rank: 3, value: 80, valueDiff: 20, historyGapNote: "历史来源缺失" },
      "total"
    );
    expect(onBoard.rankText).toBe("3");
    expect(onBoard.valueText).toBe("80");
    expect(onBoard.valueDiffText).toBe("差 20");
    expect(onBoard.historyGapNote).toBe("历史来源缺失");
  });

  it("有正分但快照落后时，不能把原因说成零分不上榜", () => {
    const delayed = meViewOf({ participating: true, onBoard: false, value: 10 }, "total", "delayed");
    expect(delayed.valueText).toBe("10");
    expect(delayed.hint).toContain("待进榜");
    expect(delayed.hint).toContain("10");
    expect(delayed.hint).not.toContain("零分");

    const unpublished = meViewOf({ participating: true, onBoard: false, value: 10 }, "total", "unpublished");
    expect(unpublished.hint).toContain("待进榜");

    const updatingCategory = meViewOf({ participating: true, onBoard: false, value: 10 }, "category", "updating");
    expect(updatingCategory.hint).toContain("待进榜");

    // 快照已是最新却仍不在榜：提示去后台重建，而不是零分。
    const freshWithValue = meViewOf({ participating: true, onBoard: false, value: 10 }, "total", "fresh");
    expect(freshWithValue.hint).toContain("重建");
    expect(freshWithValue.hint).not.toContain("零分");

    // 没有可追溯正分时才回落到"零分不上榜"。
    const zeroValue = meViewOf({ participating: true, onBoard: false, value: 0 }, "total", "delayed");
    expect(zeroValue.hint).toContain("零分");
    expect(zeroValue.valueText).toBe("0");
  });

  it("历史缺口与退出提示只在需要时出现", () => {
    expect(staleNoticeOf(0)).toBe("");
    expect(staleNoticeOf(2)).toContain("已即时隐藏");
    expect(historyGapTextOf({ members: 0, score: 0 })).toBe("");
    const gap = historyGapTextOf({ members: 1, score: 9, note: "不补记" });
    expect(gap).toContain("1 位会员");
    expect(gap).toContain("9 分");
    expect(gap).toContain("不补记");
  });

  it("前百边界与参与人数提示", () => {
    expect(boundaryNoticeOf(50, 50, false)).toBe("");
    expect(boundaryNoticeOf(120, 103, false)).toContain("共 120 人上榜");
    expect(boundaryNoticeOf(500, 200, true)).toContain("截断");
  });

  it("空榜提示区分未选类目、未生成、待刷新与真无正分", () => {
    expect(emptyHintOf("category", "", "fresh")).toContain("选择类目");
    expect(emptyHintOf("total", "", "unpublished")).toContain("还未生成");
    expect(emptyHintOf("total", "", "updating")).toContain("还没刷新");
    expect(emptyHintOf("total", "", "delayed")).toContain("还没刷新");
    expect(emptyHintOf("total", "", "fresh")).toContain("零分");
  });

  it("类目选项按树序平铺并带缩进；父级含后代由服务端保证", () => {
    const options = categoryOptionsOf([
      { id: "c1", parentId: null, depth: 1, name: "逻辑思维" },
      { id: "c2", parentId: "c1", depth: 2, name: "演绎推理" },
      { id: "c3", parentId: "c2", depth: 3, name: "三段论" },
      { id: "c4", parentId: null, depth: 1, name: "数理思维" }
    ]);
    expect(options.map((row) => row.categoryId)).toEqual(["c1", "c2", "c3", "c4"]);
    expect(options[1]?.label.startsWith("　")).toBe(true);
    expect(options[0]?.depth).toBe(1);
    const fallback = categoryOptionsOf([{ id: "c9", depth: 2, name: "孤立节点" }]);
    expect(fallback[0]?.categoryId).toBe("c9");
    expect(categoryOptionsOf(undefined)).toEqual([]);
  });

  it("错误文案按错误码给出可执行提示", () => {
    expect(errorTextOf({ error: { code: "CATEGORY_UNAVAILABLE" } }).message).toContain("停用");
    expect(errorTextOf({ error: { code: "MEMBER_REQUIRED" } }).message).toContain("注册");
    expect(errorTextOf({ error: { code: "SERVICE_BUSY", details: { reason: "TIMEOUT" } } }).reason).toBe("TIMEOUT");
  });

  it("榜单规则说明不出现费用筛选口径", () => {
    for (const scope of ["total", "category", "week", "month"]) {
      const rule = scopeRule(scope);
      expect(rule).not.toContain("VIP 专榜");
      expect(rule.length).toBeGreaterThan(0);
    }
  });
});

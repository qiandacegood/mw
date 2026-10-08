import { fetchPaperDetail } from "../../services/mock-client";

Page({
  data: {
    title: "尚未读取",
    access: "",
    raw: ""
  },
  onLoad() {
    this.loadPaper?.();
  },
  loadPaper() {
    const res = fetchPaperDetail("paper_fict_logic_l1");
    if (res.ok) {
      this.setData({
        title: res.data.title,
        access: res.data.access,
        raw: JSON.stringify(res.data)
      });
      return;
    }
    this.setData({ title: res.error.message, raw: JSON.stringify(res) });
  }
});

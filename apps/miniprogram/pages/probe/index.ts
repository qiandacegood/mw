import { callSharedOfficial, sharedCloudReady } from "../../services/shared-cloud";

Page({
  data: {
    ready: "",
    publicResult: "尚未调用",
    memberResult: "尚未调用"
  },
  onLoad() {
    const ready = sharedCloudReady();
    this.setData({ ready: ready.reason });
  },
  async runPublic() {
    const res = await callSharedOfficial("mw-public");
    this.setData({ publicResult: JSON.stringify(res) });
  },
  async runMember() {
    const res = await callSharedOfficial("mw-member");
    this.setData({ memberResult: JSON.stringify(res) });
  }
});

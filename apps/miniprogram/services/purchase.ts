import { memberAction } from "./attempt";
import { asRecord, errorInfo } from "./browse";

export type PlanView = {
  planId: string;
  planVersion: number;
  title: string;
  durationDays: number;
  priceFen: number;
  priceNote: string;
  sort: number;
};

export function fenLabel(fen: number): string {
  return `¥${(fen / 100).toFixed(2)}（测试价）`;
}

export function daysLabel(days: number): string {
  return `${days} 天`;
}

export async function vipPlans(deviceInfo: Record<string, unknown>): Promise<Record<string, unknown>> {
  return memberAction("vip.plans", { deviceInfo });
}

export async function createOrder(plan: PlanView, clientChannel: string): Promise<Record<string, unknown>> {
  return memberAction(
    "order.create",
    { planId: plan.planId, planVersion: plan.planVersion, clientChannel },
    { idempotencyKey: `mw21/order/${plan.planId}/${plan.planVersion}/${Date.now()}` }
  );
}

export async function preparePayment(orderId: string, wxLoginCode: string): Promise<Record<string, unknown>> {
  return memberAction("payment.prepare", { orderId, wxLoginCode });
}

export async function tryForgePayment(orderId: string): Promise<Record<string, unknown>> {
  return memberAction("payment.prepare", {
    orderId,
    wxLoginCode: "forged",
    clientSuccess: true,
    env: 0,
    amountFen: 1
  });
}

export async function getOrder(orderId: string): Promise<Record<string, unknown>> {
  return memberAction("order.get", { orderId });
}

export async function listOrders(): Promise<Record<string, unknown>> {
  return memberAction("order.list", { limit: 20 });
}

export async function refreshOrder(orderId: string): Promise<Record<string, unknown>> {
  return memberAction("order.refresh", { orderId });
}

export async function closeOrder(orderId: string): Promise<Record<string, unknown>> {
  return memberAction("order.close", { orderId, confirmed: true });
}

export async function requestRefund(orderId: string, reason: string): Promise<Record<string, unknown>> {
  return memberAction("refund.request", { orderId, reason });
}

export function loginCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (res) => resolve(String(res.code || "")),
      fail: () => reject(new Error("wx.login failed"))
    });
  });
}

export function requestVirtualPayment(params: Record<string, unknown>): Promise<{ ok: boolean; errMsg: string }> {
  return new Promise((resolve) => {
    const pay = (wx as unknown as { requestVirtualPayment?: (opts: Record<string, unknown>) => void }).requestVirtualPayment;
    if (typeof pay !== "function") {
      resolve({ ok: false, errMsg: "requestVirtualPayment unavailable" });
      return;
    }
    pay({
      ...params,
      success: () => resolve({ ok: true, errMsg: "ok" }),
      fail: (err: { errMsg?: string }) => resolve({ ok: false, errMsg: String(err?.errMsg || "fail") })
    });
  });
}

export function checkoutParamsOf(res: Record<string, unknown>): Record<string, unknown> | undefined {
  if (res.ok !== true) return undefined;
  const data = asRecord(res.data);
  if (!data.signData || !data.paySig || !data.signature) return undefined;
  return {
    mode: data.mode || "short_series_goods",
    signData: data.signData,
    paySig: data.paySig,
    signature: data.signature
  };
}

export { asRecord, errorInfo };

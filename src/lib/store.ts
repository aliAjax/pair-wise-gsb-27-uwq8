import { reactive, computed } from "vue";
import type { DeskState, Quote, QuoteSnapshot, RateVersion } from "../types";
import {
  buildSnapshot,
  matchRate,
  reconcile,
  round2,
  type MatchFailureReason,
  type MatchResult,
  type QuoteInput,
  type ReconcileResult,
} from "./pricing";
import { buildSeedState } from "./seed";

const STORAGE_KEY = "hxwlfront-13-rate-desk-v1";

export interface DraftForm {
  customerId: string;
  route: string;
  service: Quote["service"] | "";
  chargeableWeight: number | null;
  remark: string;
}

export interface ActionResult {
  ok: boolean;
  reason?: MatchFailureReason;
  match?: MatchResult;
  quoteId?: string;
}

function loadState(): DeskState {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as DeskState;
      if (parsed.customers && parsed.rates && parsed.quotes) return parsed;
    } catch {
      // 数据损坏时回落到种子数据
    }
  }
  return buildSeedState();
}

const state = reactive<DeskState>(loadState());

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function nextQuoteNo(status: "草稿" | "已发送"): string {
  const prefix = status === "已发送" ? "Q" : "D";
  let max = 0;
  for (const quote of state.quotes) {
    const match = /^[QD]-(\d{8})-(\d+)$/.exec(quote.quoteNo);
    if (match) max = Math.max(max, Number(match[2]));
  }
  const dateStr = today().split("-").join("");
  return `${prefix}-${dateStr}-${String(max + 1).padStart(3, "0")}`;
}

function resolveCustomer(customerId: string) {
  return state.customers.find((customer) => customer.id === customerId);
}

function toQuoteInput(form: {
  customerId: string;
  route: string;
  service: Quote["service"] | "";
  chargeableWeight: number | null;
}): QuoteInput | null {
  const customer = resolveCustomer(form.customerId);
  if (!customer || !form.route || !form.service || !form.chargeableWeight) return null;
  return {
    grade: customer.grade,
    route: form.route.trim(),
    service: form.service,
    chargeableWeight: Number(form.chargeableWeight),
    quoteDate: today(),
  };
}

/** 发送前试算: 返回匹配结果(不写数据), UI 用于"无适用版本则阻止发送" */
export function previewMatch(form: DraftForm): { input: QuoteInput | null; match: MatchResult } {
  const input = toQuoteInput(form);
  if (!input) return { input: null, match: { ok: false, reason: "未选择" } };
  return { input, match: matchRate(state.rates, input) };
}

export function saveDraft(form: DraftForm): string {
  const customer = resolveCustomer(form.customerId);
  if (!customer) throw new Error("请选择客户");
  const quote: Quote = {
    id: crypto.randomUUID(),
    quoteNo: nextQuoteNo("草稿"),
    customerId: customer.id,
    customerName: customer.name,
    grade: customer.grade,
    route: form.route.trim(),
    service: form.service || "标准达",
    chargeableWeight: Number(form.chargeableWeight) || 0,
    remark: form.remark,
    status: "草稿",
    revisions: [],
    createdAt: new Date().toISOString(),
    sentAt: null,
  };
  state.quotes = [quote, ...state.quotes];
  persist();
  return quote.id;
}

/** 发送草稿: 必须匹配到生效运价版本, 否则阻止 */
export function sendDraft(quoteId: string): ActionResult {
  const quote = state.quotes.find((item) => item.id === quoteId);
  if (!quote || quote.status !== "草稿") return { ok: false, reason: "未选择" };

  const input: QuoteInput = {
    grade: quote.grade,
    route: quote.route,
    service: quote.service,
    chargeableWeight: quote.chargeableWeight,
    quoteDate: today(),
  };
  const match = matchRate(state.rates, input);
  if (!match.ok || !match.version) return { ok: false, reason: match.reason, match };

  const now = new Date().toISOString();
  quote.revisions = [
    { revisionNo: 0, reason: "首次报价", createdAt: now, snapshot: buildSnapshot(match.version, input, now) },
  ];
  quote.status = "已发送";
  quote.sentAt = now;
  quote.quoteNo = nextQuoteNo("已发送");
  persist();
  return { ok: true, match, quoteId };
}

/** 表单直接"计算并发送": 匹配失败即阻止, 不产生任何记录 */
export function sendFromForm(form: DraftForm): ActionResult {
  const { input, match } = previewMatch(form);
  if (!input) return { ok: false, reason: "未选择", match };
  if (!match.ok || !match.version) return { ok: false, reason: match.reason, match };

  const customer = resolveCustomer(form.customerId)!;
  const now = new Date().toISOString();
  const quote: Quote = {
    id: crypto.randomUUID(),
    quoteNo: nextQuoteNo("已发送"),
    customerId: customer.id,
    customerName: customer.name,
    grade: customer.grade,
    route: input.route,
    service: input.service,
    chargeableWeight: input.chargeableWeight,
    remark: form.remark,
    status: "已发送",
    revisions: [
      { revisionNo: 0, reason: "首次报价", createdAt: now, snapshot: buildSnapshot(match.version, input, now) },
    ],
    createdAt: now,
    sentAt: now,
  };
  state.quotes = [quote, ...state.quotes];
  persist();
  return { ok: true, match, quoteId: quote.id };
}

/**
 * 已发送报价只允许新建带原因的修订:
 * 重新匹配现行版本并冻结新快照, 追加到修订链; 原报价快照永不覆盖。
 */
export function reviseQuote(
  quoteId: string,
  chargeableWeight: number,
  reason: string
): ActionResult {
  const quote = state.quotes.find((item) => item.id === quoteId);
  if (!quote || quote.status !== "已发送") return { ok: false, reason: "未选择" };

  const input: QuoteInput = {
    grade: quote.grade,
    route: quote.route,
    service: quote.service,
    chargeableWeight: Number(chargeableWeight),
    quoteDate: today(),
  };
  const match = matchRate(state.rates, input);
  if (!match.ok || !match.version) return { ok: false, reason: match.reason, match };

  const now = new Date().toISOString();
  const nextNo = quote.revisions.length ? Math.max(...quote.revisions.map((r) => r.revisionNo)) + 1 : 0;
  quote.revisions.push({
    revisionNo: nextNo,
    reason,
    createdAt: now,
    snapshot: buildSnapshot(match.version, input, now),
  });
  quote.chargeableWeight = input.chargeableWeight;
  persist();
  return { ok: true, match, quoteId };
}

/** 撤销运价版本: 仅影响后续匹配, 已冻结的历史报价仍按快照核对 */
export function revokeRate(rateId: string, reason: string) {
  const rate = state.rates.find((item) => item.id === rateId);
  if (!rate || rate.status === "已撤销") return;
  rate.status = "已撤销";
  rate.revokedAt = new Date().toISOString();
  rate.revokeReason = reason || "未注明原因";
  persist();
}

/** 仅允许删除草稿; 已发送报价是不可变凭证 */
export function deleteQuote(quoteId: string): boolean {
  const quote = state.quotes.find((item) => item.id === quoteId);
  if (!quote || quote.status === "已发送") return false;
  state.quotes = state.quotes.filter((item) => item.id !== quoteId);
  persist();
  return true;
}

export function checkSnapshot(snapshot: QuoteSnapshot): ReconcileResult {
  return reconcile(snapshot, state.rates);
}

export function resetToSeed() {
  const seed = buildSeedState();
  state.customers = seed.customers;
  state.rates = seed.rates;
  state.quotes = seed.quotes;
  persist();
}

export function useDeskStore() {
  return {
    state,
    customers: computed(() => state.customers),
    rates: computed(() => state.rates),
    quotes: computed(() => state.quotes),
    activeRates: computed(() => state.rates.filter((rate) => rate.status === "生效中")),
  };
}

export type { Quote, RateVersion, QuoteSnapshot };
export { round2 };

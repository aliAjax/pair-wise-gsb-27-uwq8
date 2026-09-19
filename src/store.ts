import { defineStore } from "pinia";
import { computed, ref } from "vue";
import {
  addDays,
  buildSnapshot,
  explainNoMatch,
  findApplicableRates,
  matchRate,
  priceQuote,
  round2,
  todayStr,
  verifySnapshot,
} from "./pricing";
import { buildSeedState } from "./seed";
import type {
  AppState,
  Customer,
  CustomerGrade,
  QuoteInput,
  QuoteRecord,
  RateVersion,
  ServiceType,
} from "./types";

const STORAGE_KEY = "hxwlfront-13-rate-desk-v1";

function loadState(): AppState {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      return JSON.parse(raw) as AppState;
    } catch {
      // 损坏数据回落种子
    }
  }
  return buildSeedState();
}

export interface QuotePreview {
  rate: RateVersion;
  snapshot: ReturnType<typeof buildSnapshot>;
  validFrom: string;
  validTo: string;
}

export interface RateDraft {
  grade: CustomerGrade;
  route: string;
  service: ServiceType;
  minWeight: number;
  maxWeight: number | null;
  unitPrice: number;
  fuelRate: number;
  minCharge: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  quoteValidDays: number;
  note: string;
}

export const useDeskStore = defineStore("rateDesk", () => {
  const initial = loadState();
  const customers = ref<Customer[]>(initial.customers);
  const rates = ref<RateVersion[]>(initial.rates);
  const quotes = ref<QuoteRecord[]>(initial.quotes);
  const seq = ref(initial.seq);

  function persist() {
    const state: AppState = {
      customers: customers.value,
      rates: rates.value,
      quotes: quotes.value,
      seq: seq.value,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function resetDemo() {
    const seed = buildSeedState();
    customers.value = seed.customers;
    rates.value = seed.rates;
    quotes.value = seed.quotes;
    seq.value = seed.seq;
    persist();
  }

  const customerById = (id: string) => customers.value.find((c) => c.id === id);

  function gradeOf(customerId: string): CustomerGrade | null {
    return customerById(customerId)?.grade ?? null;
  }

  function rateById(id: string | null | undefined) {
    return rates.value.find((r) => r.id === id) ?? null;
  }

  // ---------- 运价版本 ----------

  /**
   * 建档生效运价。同维度（等级/线路/服务）且重量区间与生效区间重叠的
   * 在用版本视为被新版本顶替：旧版本生效截止日截到新版生效前一天，状态保留
   * （历史报价仍可按其快照核对），新版本记录 supersedesId。
   */
  function addRate(draft: RateDraft): RateVersion {
    if (!draft.route.trim()) throw new Error("请填写运输线路");
    if (!(draft.minWeight >= 0)) throw new Error("重量下限需 ≥ 0");
    if (draft.maxWeight !== null && draft.maxWeight < draft.minWeight) {
      throw new Error("重量上限不能小于下限");
    }
    if (!(draft.unitPrice > 0)) throw new Error("单价需大于 0");
    if (!(draft.fuelRate >= 0 && draft.fuelRate < 1)) throw new Error("燃油费率应在 0 ~ 100% 之间");
    if (!(draft.minCharge >= 0)) throw new Error("最低收费需 ≥ 0");
    if (!(draft.quoteValidDays > 0)) throw new Error("报价有效期天数需大于 0");
    if (!draft.effectiveFrom) throw new Error("请选择生效日期");
    if (draft.effectiveTo && draft.effectiveTo < draft.effectiveFrom) {
      throw new Error("失效日期不能早于生效日期");
    }

    const overlaps = rates.value
      .filter(
        (r) =>
          r.status === "生效中" &&
          r.grade === draft.grade &&
          r.route === draft.route.trim() &&
          r.service === draft.service &&
          weightOverlap(r, draft.minWeight, draft.maxWeight) &&
          dateOverlap(r.effectiveFrom, r.effectiveTo, draft.effectiveFrom, draft.effectiveTo)
      )
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

    const superseded = overlaps[0] ?? null;
    for (const old of overlaps) {
      // 截断旧版本有效期至新版生效前一天
      old.effectiveTo = addDays(draft.effectiveFrom, -1);
    }

    const id = `rv-${String(seq.value.rate).padStart(3, "0")}`;
    seq.value.rate += 1;
    const version: RateVersion = {
      id,
      code: `RT-${seq.value.rate}-${draft.service.slice(0, 1)}`,
      grade: draft.grade,
      route: draft.route.trim(),
      service: draft.service,
      minWeight: draft.minWeight,
      maxWeight: draft.maxWeight,
      unitPrice: round2(draft.unitPrice),
      fuelRate: draft.fuelRate,
      minCharge: round2(draft.minCharge),
      effectiveFrom: draft.effectiveFrom,
      effectiveTo: draft.effectiveTo,
      quoteValidDays: draft.quoteValidDays,
      status: "生效中",
      createdAt: new Date().toISOString(),
      revokedAt: null,
      revokeReason: null,
      supersedesId: superseded?.id ?? null,
      note: draft.note.trim(),
    };
    rates.value = [version, ...rates.value];
    persist();
    return version;
  }

  /** 撤销运价：状态变更可被所有报价链实时看到，但不改动任何历史快照 */
  function revokeRate(id: string, reason: string) {
    const rate = rates.value.find((r) => r.id === id);
    if (!rate) throw new Error("运价版本不存在");
    if (rate.status === "已撤销") throw new Error("该版本已撤销");
    if (!reason.trim()) throw new Error("撤销必须填写原因");
    rate.status = "已撤销";
    rate.revokedAt = new Date().toISOString();
    rate.revokeReason = reason.trim();
    persist();
  }

  /** 仅允许删除从未被报价引用的版本 */
  function deleteRate(id: string) {
    const used = quotes.value.some((q) => q.snapshot?.rateVersionId === id);
    if (used) throw new Error("该运价版本已被报价引用，不能删除（如需停用请撤销）");
    rates.value = rates.value.filter((r) => r.id !== id);
    persist();
  }

  // ---------- 报价 ----------

  function resolveInput(input: QuoteInput, onDate = todayStr()) {
    const customer = customerById(input.customerId);
    if (!customer) throw new Error("请选择客户");
    if (!input.route.trim()) throw new Error("请填写运输线路");
    if (!(input.weight > 0)) throw new Error("计费重需大于 0");
    const grade = customer.grade;
    const matched = matchRate(rates.value, {
      grade,
      route: input.route.trim(),
      service: input.service,
      weight: input.weight,
      onDate,
    });
    return { customer, grade, matched };
  }

  /** 发送前试算：返回适用版本与将被冻结的金额，不写状态 */
  function preview(input: QuoteInput, onDate = todayStr()): QuotePreview {
    const { grade, matched } = resolveInput(input, onDate);
    if (!matched) {
      throw new Error(
        explainNoMatch(rates.value, {
          grade,
          route: input.route.trim(),
          service: input.service,
          weight: input.weight,
          onDate,
        })
      );
    }
    const snapshot = buildSnapshot(matched, input.weight);
    return {
      rate: matched,
      snapshot,
      validFrom: onDate,
      validTo: addDays(onDate, matched.quoteValidDays),
    };
  }

  function saveDraft(input: QuoteInput, note: string): QuoteRecord {
    const customer = customerById(input.customerId);
    if (!customer) throw new Error("请选择客户");
    if (!input.route.trim()) throw new Error("请填写运输线路");
    if (!(input.weight > 0)) throw new Error("计费重需大于 0");
    const quote = newQuote({
      input: { ...input, route: input.route.trim() },
      status: "草稿",
      snapshot: null,
      validFrom: null,
      validTo: null,
      sentAt: null,
      rootId: "",
      revisionNo: 1,
      parentId: null,
      revisionReason: null,
      note,
    });
    quote.rootId = quote.id;
    quotes.value = [quote, ...quotes.value];
    persist();
    return quote;
  }

  /** 生成报价：必须匹配到生效运价版本，否则阻止发送并冻结快照 */
  function sendQuote(input: QuoteInput, note: string): QuoteRecord {
    const pv = preview(input);
    const quote = newQuote({
      input: { ...input, route: input.route.trim() },
      status: "已发送",
      snapshot: pv.snapshot,
      validFrom: pv.validFrom,
      validTo: pv.validTo,
      sentAt: new Date().toISOString(),
      rootId: "",
      revisionNo: 1,
      parentId: null,
      revisionReason: null,
      note,
    });
    quote.rootId = quote.id;
    quotes.value = [quote, ...quotes.value];
    persist();
    return quote;
  }

  function sendDraft(id: string) {
    const quote = quotes.value.find((q) => q.id === id);
    if (!quote || quote.status !== "草稿") throw new Error("只有草稿可以发送");
    const pv = preview({
      customerId: quote.customerId,
      route: quote.route,
      weight: quote.weight,
      service: quote.service,
    });
    quote.status = "已发送";
    quote.snapshot = pv.snapshot;
    quote.validFrom = pv.validFrom;
    quote.validTo = pv.validTo;
    quote.sentAt = new Date().toISOString();
    persist();
  }

  /**
   * 修订：原报价不覆盖。基于已发送报价新建一版，必须填写原因；
   * 按今天的日期重新匹配运价并冻结新快照，父版本置为“已修订”。
   */
  function reviseQuote(
    parentId: string,
    input: QuoteInput,
    reason: string,
    note: string
  ): QuoteRecord {
    const parent = quotes.value.find((q) => q.id === parentId);
    if (!parent) throw new Error("原报价不存在");
    if (parent.status !== "已发送") {
      throw new Error("仅已发送且未再被修订的报价可以发起修订");
    }
    if (!reason.trim()) throw new Error("修订必须填写原因");

    const pv = preview(input);
    const chain = chainOf(parent.rootId);
    const revisionNo = Math.max(...chain.map((q) => q.revisionNo)) + 1;
    const revision = newQuote({
      quoteNo: `${parent.quoteNo.split("-R")[0]}-R${revisionNo}`,
      input: { ...input, route: input.route.trim() },
      status: "已发送",
      snapshot: pv.snapshot,
      validFrom: pv.validFrom,
      validTo: pv.validTo,
      sentAt: new Date().toISOString(),
      rootId: parent.rootId,
      revisionNo,
      parentId: parent.id,
      revisionReason: reason.trim(),
      note,
    });
    parent.status = "已修订";
    quotes.value = [revision, ...quotes.value];
    persist();
    return revision;
  }

  function closeQuote(id: string, reason: string) {
    const quote = quotes.value.find((q) => q.id === id);
    if (!quote) throw new Error("报价不存在");
    if (quote.status === "草稿") throw new Error("草稿请直接删除");
    if (quote.status === "已关闭") throw new Error("报价已关闭");
    if (!reason.trim()) throw new Error("关闭必须填写原因");
    quote.status = "已关闭";
    quote.closedReason = reason.trim();
    persist();
  }

  function removeQuote(id: string) {
    const quote = quotes.value.find((q) => q.id === id);
    if (!quote) return;
    if (quote.status !== "草稿") {
      throw new Error("已发送报价及修订链不可删除，以保证可追溯");
    }
    quotes.value = quotes.value.filter((q) => q.id !== id);
    persist();
  }

  function newQuote(parts: {
    quoteNo?: string;
    input: QuoteInput;
    status: QuoteRecord["status"];
    snapshot: QuoteRecord["snapshot"];
    validFrom: string | null;
    validTo: string | null;
    sentAt: string | null;
    rootId: string;
    revisionNo: number;
    parentId: string | null;
    revisionReason: string | null;
    note: string;
  }): QuoteRecord {
    const n = seq.value.quote;
    seq.value.quote += 1;
    const quoteNo = parts.quoteNo ?? `BJ-${String(n).padStart(4, "0")}`;
    return {
      id: `q-${crypto.randomUUID()}`,
      quoteNo,
      ...parts.input,
      status: parts.status,
      validFrom: parts.validFrom,
      validTo: parts.validTo,
      snapshot: parts.snapshot,
      note: parts.note.trim() || (parts.status === "草稿" ? "草稿暂无备注" : "系统报价"),
      createdAt: new Date().toISOString(),
      sentAt: parts.sentAt,
      rootId: parts.rootId,
      revisionNo: parts.revisionNo,
      parentId: parts.parentId,
      revisionReason: parts.revisionReason,
      closedReason: null,
    };
  }

  // ---------- 追溯/核对 ----------

  /** 同一报价链（含首版与全部修订），按版本号升序 */
  function chainOf(rootId: string): QuoteRecord[] {
    return quotes.value
      .filter((q) => q.rootId === rootId)
      .sort((a, b) => a.revisionNo - b.revisionNo || a.createdAt.localeCompare(b.createdAt));
  }

  const roots = computed(() =>
    quotes.value
      .filter((q) => q.parentId === null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  );

  /**
   * 快照核对（刷新即实时）：
   * - 快照版本已撤销/删除 => 金额仍以快照为准，标记按快照核对
   * - 该维度今日已匹配到其他版本（换版）=> 漂移提示，金额不变
   * - 快照版本仍是当前适用版本 => 重算一致
   */
  function check(quote: QuoteRecord) {
    if (!quote.snapshot) {
      return { state: "draft" as const, text: "草稿未冻结", same: false, rate: null, expired: false };
    }
    const today = todayStr();
    const expired = quote.validTo !== null && today > quote.validTo;
    const result = verifySnapshot(rates.value, quote.snapshot, quote.weight);

    if (!result.ok) {
      return { state: "missing" as const, text: result.reason, same: false, rate: null, expired };
    }
    if (result.rate.status === "已撤销") {
      return {
        state: "revoked" as const,
        text: `运价版本 ${result.rate.code} 已撤销，历史报价按快照核对`,
        same: result.same,
        rate: result.rate,
        expired,
      };
    }

    const customer = customerById(quote.customerId);
    const current = customer
      ? matchRate(rates.value, {
          grade: customer.grade,
          route: quote.route,
          service: quote.service,
          weight: quote.weight,
          onDate: today,
        })
      : null;

    if (current && current.id !== quote.snapshot.rateVersionId) {
      const latest = priceQuote(current, quote.weight).totalAmount;
      return {
        state: "drift" as const,
        text: `该维度现行运价已换版为 ${current.code}（现价重算 ¥${latest.toFixed(2)}），报价仍按发送时快照执行`,
        same: false,
        rate: result.rate,
        currentRate: current,
        expired,
      };
    }

    return {
      state: result.same ? ("same" as const) : ("drift" as const),
      text: result.same
        ? "与现行运价一致"
        : "现行运价已调整，报价金额仍以发送时快照为准",
      same: result.same,
      rate: result.rate,
      currentRate: current,
      expired,
    };
  }

  function candidatesFor(input: QuoteInput, onDate = todayStr()) {
    const grade = gradeOf(input.customerId);
    if (!grade) return [];
    return findApplicableRates(rates.value, {
      grade,
      route: input.route.trim(),
      service: input.service,
      weight: input.weight,
      onDate,
    });
  }

  function recompute(rate: RateVersion, weight: number) {
    return priceQuote(rate, weight);
  }

  return {
    customers,
    rates,
    quotes,
    roots,
    customerById,
    gradeOf,
    rateById,
    addRate,
    revokeRate,
    deleteRate,
    preview,
    saveDraft,
    sendQuote,
    sendDraft,
    reviseQuote,
    closeQuote,
    removeQuote,
    chainOf,
    check,
    candidatesFor,
    recompute,
    resetDemo,
  };
});

function weightOverlap(
  rate: RateVersion,
  minWeight: number,
  maxWeight: number | null
): boolean {
  const aLo = rate.minWeight;
  const aHi = rate.maxWeight ?? Number.POSITIVE_INFINITY;
  const bLo = minWeight;
  const bHi = maxWeight ?? Number.POSITIVE_INFINITY;
  return aLo <= bHi && bLo <= aHi;
}

function dateOverlap(
  aFrom: string,
  aTo: string | null,
  bFrom: string,
  bTo: string | null
): boolean {
  const aStart = aFrom;
  const aEnd = aTo ?? "9999-12-31";
  const bStart = bFrom;
  const bEnd = bTo ?? "9999-12-31";
  return aStart <= bEnd && bStart <= aEnd;
}

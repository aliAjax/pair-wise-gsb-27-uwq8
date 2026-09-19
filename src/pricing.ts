import type {
  CustomerGrade,
  MatchInput,
  QuoteSnapshot,
  RateVersion,
  ServiceType,
} from "./types";

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function todayStr(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = new Date(date + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function withinDateRange(date: string, from: string, to: string | null): boolean {
  if (date < from) return false;
  if (to && date > to) return false;
  return true;
}

export interface RateMatch {
  rate: RateVersion;
}

/** 维度 + 日期 + 重量 全部匹配的生效版本；同维度多版本时取生效起始日最新者 */
export function findApplicableRates(rates: RateVersion[], input: MatchInput): RateVersion[] {
  return rates
    .filter(
      (r) =>
        r.status === "生效中" &&
        r.grade === input.grade &&
        r.route === input.route &&
        r.service === input.service &&
        input.weight >= r.minWeight &&
        (r.maxWeight === null || input.weight <= r.maxWeight) &&
        withinDateRange(input.onDate, r.effectiveFrom, r.effectiveTo)
    )
    .sort((a, b) => {
      if (a.effectiveFrom !== b.effectiveFrom) {
        return a.effectiveFrom < b.effectiveFrom ? 1 : -1;
      }
      return a.createdAt < b.createdAt ? 1 : -1;
    });
}

export function matchRate(rates: RateVersion[], input: MatchInput): RateVersion | null {
  return findApplicableRates(rates, input)[0] ?? null;
}

/** 不满足时给出可读原因，用于阻止发送提示 */
export function explainNoMatch(
  rates: RateVersion[],
  input: MatchInput
): string {
  const sameDim = rates.filter(
    (r) =>
      r.grade === input.grade && r.route === input.route && r.service === input.service
  );
  if (sameDim.length === 0) {
    return `不存在「${input.grade} / ${input.route} / ${input.service}」的合同运价版本，请先建档生效运价。`;
  }
  const active = sameDim.filter((r) => r.status === "生效中");
  if (active.length === 0) {
    return `该维度运价版本均已撤销（${sameDim
      .map((r) => r.code)
      .join("、")}），无法据此报价。`;
  }
  const inDate = active.filter((r) =>
    withinDateRange(input.onDate, r.effectiveFrom, r.effectiveTo)
  );
  if (inDate.length === 0) {
    const dates = active.map((r) => r.effectiveFrom).sort();
    return `现有生效版本在 ${input.onDate} 不在有效期内（最晚生效 ${
      dates[dates.length - 1]
    }）。`;
  }
  const inWeight = inDate.filter(
    (r) => input.weight >= r.minWeight && (r.maxWeight === null || input.weight <= r.maxWeight)
  );
  if (inWeight.length === 0) {
    return `计费重 ${input.weight}kg 超出该维度全部生效版本的重量区间（${inDate
      .map((r) => `${r.minWeight}-${r.maxWeight ?? "∞"}kg`)
      .join("；")}）。`;
  }
  return "没有适用的运价版本。";
}

/** 依据运价版本与计费重试算，不写入任何状态 */
export function priceQuote(
  rate: RateVersion,
  weight: number
): Pick<QuoteSnapshot, "baseFreight" | "fuelSurcharge" | "totalAmount"> {
  const rawFreight = round2(rate.unitPrice * weight);
  const baseFreight = round2(Math.max(rawFreight, rate.minCharge));
  const fuelSurcharge = round2(baseFreight * rate.fuelRate);
  const totalAmount = round2(baseFreight + fuelSurcharge);
  return { baseFreight, fuelSurcharge, totalAmount };
}

export function buildSnapshot(rate: RateVersion, weight: number): QuoteSnapshot {
  const { baseFreight, fuelSurcharge, totalAmount } = priceQuote(rate, weight);
  return {
    rateVersionId: rate.id,
    rateCode: rate.code,
    unitPrice: rate.unitPrice,
    fuelRate: rate.fuelRate,
    minCharge: rate.minCharge,
    baseFreight,
    fuelSurcharge,
    totalAmount,
    currency: "CNY",
  };
}

export type VerifyResult =
  | { ok: true; rate: RateVersion; same: boolean }
  | { ok: false; reason: string };

/**
 * 历史报价按冻结快照核对：
 * - 版本已撤销/删除 => 仍可核对金额，标记“已撤销，按快照核对”
 * - 版本仍生效 => 重新试算，金额一致才视为同价
 */
export function verifySnapshot(
  rates: RateVersion[],
  snapshot: QuoteSnapshot,
  weight: number
): VerifyResult {
  const rate = rates.find((r) => r.id === snapshot.rateVersionId);
  if (!rate) {
    return { ok: false, reason: "运价版本已不存在，报价金额以快照为准，无法与现行版本核对" };
  }
  const calc = priceQuote(rate, weight);
  const same =
    rate.unitPrice === snapshot.unitPrice &&
    rate.fuelRate === snapshot.fuelRate &&
    rate.minCharge === snapshot.minCharge &&
    calc.totalAmount === snapshot.totalAmount;
  return { ok: true, rate, same };
}

export const GRADES: CustomerGrade[] = ["战略客户", "重点客户", "普通客户"];
export const SERVICES: ServiceType[] = ["标准达", "次日达", "冷链"];

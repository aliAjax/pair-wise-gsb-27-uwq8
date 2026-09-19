import type {
  CustomerGrade,
  QuoteSnapshot,
  RateStatus,
  RateVersion,
  ServiceType,
} from "../types";

/** 金额比较/校验允许误差(分以下) */
const EPS = 0.005;

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** 基础运费 = max(起步价, 计费重 × 单价) */
export function calcBaseFreight(weight: number, unitPrice: number, baseFee: number): number {
  return round2(Math.max(baseFee, round2(weight * unitPrice)));
}

export function calcFuel(baseFreight: number, fuelRate: number): number {
  return round2(baseFreight * fuelRate);
}

export interface QuoteInput {
  grade: CustomerGrade;
  route: string;
  service: ServiceType;
  chargeableWeight: number;
  /** 报价有效期(通常取运价版本失效日), YYYY-MM-DD */
  quoteDate: string;
}

export type MatchFailureReason =
  | "未选择"
  | "无该组合运价"
  | "重量超出重段"
  | "当前不在有效期内"
  | "运价版本已撤销";

export interface MatchResult {
  ok: boolean;
  /** ok 时为命中版本; 失败时为按维度筛选出的最近候选(用于解释为何不可用) */
  version?: RateVersion;
  reason?: MatchFailureReason;
}

export interface MatchCandidates {
  /** 维度完全匹配(等级/线路/服务/重段)但可能失效或已撤销的版本 */
  dimensionMatches: RateVersion[];
}

function inBracket(rate: RateVersion, weight: number): boolean {
  return weight >= rate.weightMin && (rate.weightMax === null || weight <= rate.weightMax);
}

/**
 * 运价匹配:
 * 1. 等级 + 线路 + 服务类型 完全一致
 * 2. 计费重落入重段
 * 3. 报价日期在生效区间内
 * 4. 版本状态为 生效中
 * 多版本命中时取最晚生效的版本(合同换版)
 */
export function matchRate(rates: RateVersion[], input: QuoteInput): MatchResult {
  const { grade, route, service, chargeableWeight, quoteDate } = input;

  if (!grade || !route || !service || !chargeableWeight || chargeableWeight <= 0) {
    return { ok: false, reason: "未选择" };
  }

  const sameCombo = rates.filter(
    (rate) => rate.grade === grade && rate.route === route && rate.service === service
  );

  if (sameCombo.length === 0) {
    return { ok: false, reason: "无该组合运价" };
  }

  const bracketMatches = sameCombo.filter((rate) => inBracket(rate, chargeableWeight));
  if (bracketMatches.length === 0) {
    return {
      ok: false,
      reason: "重量超出重段",
      version: [...sameCombo].sort((a, b) => a.weightMin - b.weightMin)[0],
    };
  }

  const dateMatches = bracketMatches.filter(
    (rate) => quoteDate >= rate.validFrom && quoteDate <= rate.validTo
  );
  if (dateMatches.length === 0) {
    return {
      ok: false,
      reason: "当前不在有效期内",
      version: [...bracketMatches].sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0],
    };
  }

  const active = dateMatches.filter((rate) => rate.status === "生效中");
  if (active.length === 0) {
    return {
      ok: false,
      reason: "运价版本已撤销",
      version: [...dateMatches].sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0],
    };
  }

  const chosen = [...active].sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0];
  return { ok: true, version: chosen };
}

/** 快照参与指纹的字段顺序, 改动即视为快照被篡改 */
const FINGERPRINT_FIELDS = [
  "rateVersionId",
  "grade",
  "route",
  "service",
  "chargeableWeight",
  "unitPrice",
  "baseFee",
  "fuelRate",
  "baseFreight",
  "fuelSurcharge",
  "totalAmount",
  "currency",
  "validFrom",
  "validTo",
  "frozenAt",
] as const;

/** FNV-1a 32bit 指纹(十六进制), 本地演示用, 用于发现快照字段被手工改动 */
export function fingerprintSnapshot(snapshot: QuoteSnapshot): string {
  const text = FINGERPRINT_FIELDS.map((key) => `${key}=${snapshot[key]}`).join("|");
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** 依据生效运价版本冻结报价快照(发送/修订时调用) */
export function buildSnapshot(
  rate: RateVersion,
  input: QuoteInput,
  frozenAt: string
): QuoteSnapshot {
  const baseFreight = calcBaseFreight(input.chargeableWeight, rate.unitPrice, rate.baseFee);
  const fuelSurcharge = calcFuel(baseFreight, rate.fuelRate);
  const totalAmount = round2(baseFreight + fuelSurcharge);

  const core: Omit<QuoteSnapshot, "fingerprint"> = {
    rateVersionId: rate.id,
    rateStatusAtFreeze: "生效中" as RateStatus,
    grade: input.grade,
    route: input.route,
    service: input.service,
    chargeableWeight: input.chargeableWeight,
    unitPrice: rate.unitPrice,
    baseFee: rate.baseFee,
    fuelRate: rate.fuelRate,
    baseFreight,
    fuelSurcharge,
    totalAmount,
    currency: rate.currency,
    validFrom: rate.validFrom,
    validTo: rate.validTo,
    frozenAt,
  };
  return { ...core, fingerprint: fingerprintSnapshot(core as QuoteSnapshot) };
}

export type ReconcileVerdict =
  | "一致" // 快照未改动, 引用版本仍生效且定价一致
  | "版本已撤销" // 快照完整, 但版本事后被撤销 —— 仍按快照金额核对
  | "运价已调整" // 版本仍生效但定价变了, 历史报价维持快照
  | "快照被篡改"; // 快照金额/字段与指纹不符

export interface ReconcileResult {
  verdict: ReconcileVerdict;
  detail: string;
  /** 按当前台账重算的金额(版本已删除时为空) */
  currentTotal?: number;
  referencedStatus?: RateStatus;
}

/**
 * 历史报价核对:
 * - 先校验快照指纹(防篡改);
 * - 再按快照引用的运价版本核对台账现状;
 * - 即使版本已撤销, 历史报价仍以快照金额为准。
 */
export function reconcile(snapshot: QuoteSnapshot, rates: RateVersion[]): ReconcileResult {
  const expectedFp = fingerprintSnapshot(snapshot);
  if (expectedFp !== snapshot.fingerprint) {
    return {
      verdict: "快照被篡改",
      detail: `快照字段与冻结指纹不一致(当前 ${snapshot.fingerprint} / 应为 ${expectedFp}),金额不可信。`,
    };
  }

  const rate = rates.find((item) => item.id === snapshot.rateVersionId);
  if (!rate) {
    return {
      verdict: "快照被篡改",
      detail: `快照引用的运价版本 ${snapshot.rateVersionId} 在台账中不存在。`,
    };
  }

  const recomputedBase = calcBaseFreight(
    snapshot.chargeableWeight,
    snapshot.unitPrice,
    snapshot.baseFee
  );
  const recomputedFuel = calcFuel(recomputedBase, snapshot.fuelRate);
  const recomputedTotal = round2(recomputedBase + recomputedFuel);
  const amountIntact =
    Math.abs(recomputedBase - snapshot.baseFreight) < EPS &&
    Math.abs(recomputedFuel - snapshot.fuelSurcharge) < EPS &&
    Math.abs(recomputedTotal - snapshot.totalAmount) < EPS;

  if (!amountIntact) {
    return {
      verdict: "快照被篡改",
      detail: `快照金额与冻结单价重算结果不符(快照 ${formatMoney(snapshot.totalAmount)} / 重算 ${formatMoney(recomputedTotal)})。`,
    };
  }

  const liveBase = calcBaseFreight(snapshot.chargeableWeight, rate.unitPrice, rate.baseFee);
  const liveTotal = round2(liveBase + calcFuel(liveBase, rate.fuelRate));

  if (rate.status === "已撤销") {
    return {
      verdict: "版本已撤销",
      detail: `版本 ${rate.id} 已于事后撤销(${rate.revokeReason ?? "未注明原因"}),历史报价仍按冻结快照核对,金额 ${formatMoney(snapshot.totalAmount)} 有效。`,
      currentTotal: liveTotal,
      referencedStatus: "已撤销",
    };
  }

  const priceChanged =
    rate.unitPrice !== snapshot.unitPrice ||
    rate.baseFee !== snapshot.baseFee ||
    rate.fuelRate !== snapshot.fuelRate;

  if (priceChanged) {
    return {
      verdict: "运价已调整",
      detail: `版本 ${rate.id} 定价已更新(现单价 ${rate.unitPrice}/燃油 ${rate.fuelRate}),该历史报价维持冻结金额 ${formatMoney(snapshot.totalAmount)},新发报价按 ${formatMoney(liveTotal)}。`,
      currentTotal: liveTotal,
      referencedStatus: "生效中",
    };
  }

  return {
    verdict: "一致",
    detail: `快照完整,引用版本 ${rate.id} 仍生效,核对金额 ${formatMoney(snapshot.totalAmount)} 一致。`,
    currentTotal: liveTotal,
    referencedStatus: "生效中",
  };
}

export function formatMoney(value: number, currency = "CNY"): string {
  const symbol = currency === "CNY" ? "¥" : `${currency} `;
  return `${symbol}${value.toFixed(2)}`;
}

export function formatPercent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

import type { Customer, DeskState, Quote, QuoteRevision, RateVersion } from "../types";
import { buildSnapshot, type QuoteInput } from "./pricing";

/** 以今天为基准生成 YYYY-MM-DD 偏移日期 */
function dayOffset(days: number): string {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function isoOffset(days: number, hours = 10): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hours, 0, 0, 0);
  return date.toISOString();
}

export const seedCustomers: Customer[] = [
  { id: "c-hwsm", name: "海沃商贸", grade: "VIP" },
  { id: "c-ycsp", name: "云仓食品", grade: "合约" },
  { id: "c-nljx", name: "南陵机械", grade: "标准" },
];

interface RateSeed {
  id: string;
  grade: RateVersion["grade"];
  route: string;
  service: RateVersion["service"];
  weightMin: number;
  weightMax: number | null;
  unitPrice: number;
  baseFee: number;
  fuelRate: number;
  from: number;
  to: number;
  status?: RateVersion["status"];
  revokeReason?: string;
}

const rateSeeds: RateSeed[] = [
  // 上海-南京 / 标准达 / VIP —— 两版合同, 旧版已过期, 现行 2026 版
  {
    id: "RV-SHNJ-VIP-STD-2025",
    grade: "VIP",
    route: "上海-南京",
    service: "标准达",
    weightMin: 0,
    weightMax: 100,
    unitPrice: 6.2,
    baseFee: 120,
    fuelRate: 0.08,
    from: -400,
    to: -30,
  },
  {
    id: "RV-SHNJ-VIP-STD-2026",
    grade: "VIP",
    route: "上海-南京",
    service: "标准达",
    weightMin: 0,
    weightMax: 100,
    unitPrice: 5.8,
    baseFee: 120,
    fuelRate: 0.09,
    from: -30,
    to: 335,
  },
  {
    id: "RV-SHNJ-VIP-STD-B2-2026",
    grade: "VIP",
    route: "上海-南京",
    service: "标准达",
    weightMin: 101,
    weightMax: null,
    unitPrice: 5.2,
    baseFee: 200,
    fuelRate: 0.09,
    from: -30,
    to: 335,
  },
  // 上海-南京 / 次日达 / VIP
  {
    id: "RV-SHNJ-VIP-NXT-2026",
    grade: "VIP",
    route: "上海-南京",
    service: "次日达",
    weightMin: 0,
    weightMax: 120,
    unitPrice: 7.4,
    baseFee: 150,
    fuelRate: 0.1,
    from: -60,
    to: 305,
  },
  // 杭州-合肥 / 冷链 / 合约
  {
    id: "RV-HZHF-CON-COLD-2026",
    grade: "合约",
    route: "杭州-合肥",
    service: "冷链",
    weightMin: 0,
    weightMax: 200,
    unitPrice: 8.6,
    baseFee: 260,
    fuelRate: 0.12,
    from: -90,
    to: 275,
  },
  // 广州-深圳 / 冷链 / 合约 —— 现行版本已撤销, 无新版本, 历史报价需按快照核对
  {
    id: "RV-GZSZ-CON-COLD-2025",
    grade: "合约",
    route: "广州-深圳",
    service: "冷链",
    weightMin: 0,
    weightMax: 300,
    unitPrice: 4.9,
    baseFee: 180,
    fuelRate: 0.11,
    from: -200,
    to: 165,
    status: "已撤销",
    revokeReason: "冷链承运商合同终止,等待重新招标",
  },
  // 广州-深圳 / 标准达 / 标准客户
  {
    id: "RV-GZSZ-STD-REG-2026",
    grade: "标准",
    route: "广州-深圳",
    service: "标准达",
    weightMin: 0,
    weightMax: 80,
    unitPrice: 5.6,
    baseFee: 100,
    fuelRate: 0.08,
    from: -45,
    to: 320,
  },
];

function buildRates(): RateVersion[] {
  const now = new Date().toISOString();
  return rateSeeds.map((seed) => {
    const revoked = seed.status === "已撤销";
    return {
      id: seed.id,
      grade: seed.grade,
      route: seed.route,
      service: seed.service,
      weightMin: seed.weightMin,
      weightMax: seed.weightMax,
      unitPrice: seed.unitPrice,
      baseFee: seed.baseFee,
      fuelRate: seed.fuelRate,
      validFrom: dayOffset(seed.from),
      validTo: dayOffset(seed.to),
      currency: "CNY",
      status: seed.status ?? "生效中",
      createdAt: isoOffset(Math.min(seed.from - 1, -1)),
      revokedAt: revoked ? isoOffset(-12, 16) : null,
      revokeReason: revoked ? seed.revokeReason ?? null : null,
    } satisfies RateVersion;
  });
}

function revision(
  no: number,
  rate: RateVersion,
  input: QuoteInput,
  daysAgo: number,
  reason: string
): QuoteRevision {
  return {
    revisionNo: no,
    reason,
    createdAt: isoOffset(-daysAgo, 10 + no),
    snapshot: buildSnapshot(rate, input, isoOffset(-daysAgo, 10 + no)),
  };
}

function buildQuotes(rates: RateVersion[]): Quote[] {
  const byId = (id: string) => rates.find((rate) => rate.id === id)!;

  // 1) 已发送 + 一次修订: 海沃 VIP 上海-南京 标准达
  //    首次报价落在旧合同(2025版)有效期内, 修订时已换 2026 版且跨入大货重段
  const q1Rate = byId("RV-SHNJ-VIP-STD-B2-2026");
  const q1Rev0Input: QuoteInput = {
    grade: "VIP",
    route: "上海-南京",
    service: "标准达",
    chargeableWeight: 90,
    quoteDate: dayOffset(-40),
  };
  const q1: Quote = {
    id: "seed-q1",
    quoteNo: "Q-SEED-0001",
    customerId: "c-hwsm",
    customerName: "海沃商贸",
    grade: "VIP",
    route: "上海-南京",
    service: "标准达",
    chargeableWeight: 160,
    remark: "月度框架客户,月结30天",
    status: "已发送",
    createdAt: isoOffset(-40, 9),
    sentAt: isoOffset(-40, 10),
    revisions: [
      {
        revisionNo: 0,
        reason: "首次报价",
        createdAt: isoOffset(-40, 10),
        snapshot: buildSnapshot(
          byId("RV-SHNJ-VIP-STD-2025"),
          q1Rev0Input,
          isoOffset(-40, 10)
        ),
      },
      revision(
        1,
        q1Rate,
        { grade: "VIP", route: "上海-南京", service: "标准达", chargeableWeight: 160, quoteDate: dayOffset(-10) },
        10,
        "客户确认实际计费重调整为160kg,且2026版合同已生效,按大货重段运价重新报价"
      ),
    ],
  };

  // 2) 已发送, 引用版本事后撤销: 云仓食品 广州-深圳 冷链
  const q2Rate = byId("RV-GZSZ-CON-COLD-2025");
  const q2Input: QuoteInput = {
    grade: "合约",
    route: "广州-深圳",
    service: "冷链",
    chargeableWeight: 95,
    quoteDate: dayOffset(-20),
  };
  const q2: Quote = {
    id: "seed-q2",
    quoteNo: "Q-SEED-0002",
    customerId: "c-ycsp",
    customerName: "云仓食品",
    grade: "合约",
    route: "广州-深圳",
    service: "冷链",
    chargeableWeight: 95,
    remark: "客户要求续报,但现行运价已撤销,需重新招标后修订",
    status: "已发送",
    createdAt: isoOffset(-20, 9),
    sentAt: isoOffset(-20, 10),
    revisions: [revision(0, q2Rate, q2Input, 20, "首次报价")],
  };

  // 3) 草稿: 南陵机械 广州-深圳 标准达, 70kg, 当前可匹配(可直接发送)
  const q3: Quote = {
    id: "seed-q3",
    quoteNo: "D-SEED-0003",
    customerId: "c-nljx",
    customerName: "南陵机械",
    grade: "标准",
    route: "广州-深圳",
    service: "标准达",
    chargeableWeight: 70,
    remark: "新客户首单,待销售确认折扣",
    status: "草稿",
    createdAt: isoOffset(-1, 15),
    sentAt: null,
    revisions: [],
  };

  return [q1, q2, q3];
}

export function buildSeedState(): DeskState {
  const rates = buildRates();
  return {
    customers: seedCustomers,
    rates,
    quotes: buildQuotes(rates),
  };
}

import { addDays, buildSnapshot, todayStr } from "./pricing";
import type { AppState, Customer, QuoteRecord, RateVersion } from "./types";

function rate(
  r: Omit<
    RateVersion,
    "status" | "revokedAt" | "revokeReason" | "supersedesId"
  > &
    Partial<Pick<RateVersion, "status" | "revokedAt" | "revokeReason" | "supersedesId">>
): RateVersion {
  return {
    status: "生效中",
    revokedAt: null,
    revokeReason: null,
    supersedesId: null,
    ...r,
  };
}

const customers: Customer[] = [
  { id: "c-haiwo", name: "海沃商贸", grade: "战略客户" },
  { id: "c-yuncang", name: "云仓食品", grade: "重点客户" },
  { id: "c-dongjun", name: "东骏制造", grade: "普通客户" },
];

const T = todayStr();

const rates: RateVersion[] = [
  // 战略客户 / 上海-南京 / 标准达：两段重量
  rate({
    id: "rv-001",
    code: "RT-SHW-NJH-S-001",
    grade: "战略客户",
    route: "上海-南京",
    service: "标准达",
    minWeight: 0,
    maxWeight: 100,
    unitPrice: 6.5,
    fuelRate: 0.09,
    minCharge: 120,
    effectiveFrom: addDays(T, -60),
    effectiveTo: null,
    quoteValidDays: 7,
    createdAt: addDays(T, -61) + "T02:00:00.000Z",
    note: "合同附件A，小票段",
  }),
  rate({
    id: "rv-002",
    code: "RT-SHW-NJH-S-002",
    grade: "战略客户",
    route: "上海-南京",
    service: "标准达",
    minWeight: 100.01,
    maxWeight: null,
    unitPrice: 5.8,
    fuelRate: 0.09,
    minCharge: 600,
    effectiveFrom: addDays(T, -30),
    effectiveTo: null,
    quoteValidDays: 7,
    createdAt: addDays(T, -31) + "T02:00:00.000Z",
    supersedesId: null,
    note: "续签新增大货段，小票段 rv-001 继续有效",
  }),
  // 重点客户 / 杭州-合肥 / 冷链：当前生效版 + 旧版已撤销
  rate({
    id: "rv-003",
    code: "RT-HZH-HFH-C-001",
    grade: "重点客户",
    route: "杭州-合肥",
    service: "冷链",
    minWeight: 0,
    maxWeight: null,
    unitPrice: 9.2,
    fuelRate: 0.12,
    minCharge: 300,
    effectiveFrom: addDays(T, -90),
    effectiveTo: addDays(T, -46),
    quoteValidDays: 5,
    createdAt: addDays(T, -91) + "T02:00:00.000Z",
    note: "Q2 冷链价（已撤销）",
    status: "已撤销",
    revokedAt: addDays(T, -45) + "T03:00:00.000Z",
    revokeReason: "油价联动条款重谈，旧版停用",
  }),
  rate({
    id: "rv-004",
    code: "RT-HZH-HFH-C-002",
    grade: "重点客户",
    route: "杭州-合肥",
    service: "冷链",
    minWeight: 0,
    maxWeight: null,
    unitPrice: 8.6,
    fuelRate: 0.1,
    minCharge: 280,
    effectiveFrom: addDays(T, -45),
    effectiveTo: null,
    quoteValidDays: 5,
    createdAt: addDays(T, -45) + "T02:00:00.000Z",
    supersedesId: "rv-003",
    note: "Q3 冷链价，燃油下调",
  }),
  // 普通客户 / 广州-武汉 / 次日达
  rate({
    id: "rv-005",
    code: "RT-GZW-WUH-N-001",
    grade: "普通客户",
    route: "广州-武汉",
    service: "次日达",
    minWeight: 0,
    maxWeight: 500,
    unitPrice: 7.9,
    fuelRate: 0.11,
    minCharge: 200,
    effectiveFrom: addDays(T, -20),
    effectiveTo: null,
    quoteValidDays: 3,
    createdAt: addDays(T, -21) + "T02:00:00.000Z",
    note: "旺季临时协议",
  }),
  // 战略客户 / 深圳-成都 / 次日达：未来版本，当前日期不可用
  rate({
    id: "rv-006",
    code: "RT-SZX-CTU-N-001",
    grade: "战略客户",
    route: "深圳-成都",
    service: "次日达",
    minWeight: 0,
    maxWeight: null,
    unitPrice: 11.4,
    fuelRate: 0.13,
    minCharge: 900,
    effectiveFrom: addDays(T, 7),
    effectiveTo: null,
    quoteValidDays: 5,
    createdAt: T + "T01:00:00.000Z",
    note: "下月新线预录，未到生效日",
  }),
];

function buildSeedQuotes(): QuoteRecord[] {
  const find = (id: string) => rates.find((r) => r.id === id)!;

  // 1) 已发送首版（海沃商贸 180kg 大货价）
  const v1: QuoteRecord = {
    id: "q-0001",
    quoteNo: "BJ-0001",
    customerId: "c-haiwo",
    route: "上海-南京",
    weight: 180,
    service: "标准达",
    status: "已修订",
    validFrom: addDays(T, -10),
    validTo: addDays(T, -3),
    snapshot: buildSnapshot(find("rv-002"), 180),
    note: "客户要求含燃油一口价",
    createdAt: addDays(T, -10) + "T05:30:00.000Z",
    sentAt: addDays(T, -10) + "T06:00:00.000Z",
    rootId: "q-0001",
    revisionNo: 1,
    parentId: null,
    revisionReason: null,
    closedReason: null,
  };

  // 2) 修订版：计费重调整为 200kg（演示冻结差异与修订链）
  const v2: QuoteRecord = {
    id: "q-0002",
    quoteNo: "BJ-0001-R1",
    customerId: "c-haiwo",
    route: "上海-南京",
    weight: 200,
    service: "标准达",
    status: "已发送",
    validFrom: addDays(T, -8),
    validTo: addDays(T, -1),
    snapshot: buildSnapshot(find("rv-002"), 200),
    note: "按客户最终托数重算",
    createdAt: addDays(T, -8) + "T07:10:00.000Z",
    sentAt: addDays(T, -8) + "T07:20:00.000Z",
    rootId: "q-0001",
    revisionNo: 2,
    parentId: "q-0001",
    revisionReason: "客户实际托数增加，计费重由 180kg 调整为 200kg",
    closedReason: null,
  };

  // 3) 基于已撤销旧版 rv-003 的历史报价：撤销后仍按快照核对
  const v3: QuoteRecord = {
    id: "q-0003",
    quoteNo: "BJ-0002",
    customerId: "c-yuncang",
    route: "杭州-合肥",
    weight: 95,
    service: "冷链",
    status: "已发送",
    validFrom: addDays(T, -80),
    validTo: addDays(T, -75),
    snapshot: buildSnapshot(find("rv-003"), 95),
    note: "Q2 批次冷链报价（运价版本后已撤销）",
    createdAt: addDays(T, -80) + "T08:00:00.000Z",
    sentAt: addDays(T, -80) + "T08:05:00.000Z",
    rootId: "q-0003",
    revisionNo: 1,
    parentId: null,
    revisionReason: null,
    closedReason: null,
  };

  // 4) 草稿：尚无快照，发送时再匹配
  const v4: QuoteRecord = {
    id: "q-0004",
    quoteNo: "BJ-0003",
    customerId: "c-dongjun",
    route: "广州-武汉",
    weight: 60,
    service: "次日达",
    status: "草稿",
    validFrom: null,
    validTo: null,
    snapshot: null,
    note: "待客户确认提货时间",
    createdAt: addDays(T, -1) + "T09:00:00.000Z",
    sentAt: null,
    rootId: "q-0004",
    revisionNo: 1,
    parentId: null,
    revisionReason: null,
    closedReason: null,
  };

  return [v2, v1, v3, v4];
}

export function buildSeedState(): AppState {
  return {
    customers,
    rates,
    quotes: buildSeedQuotes(),
    seq: { rate: 7, quote: 4 },
  };
}

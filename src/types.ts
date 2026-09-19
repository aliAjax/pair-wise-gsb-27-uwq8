export type CustomerGrade = "VIP" | "合约" | "标准";

export type ServiceType = "标准达" | "次日达" | "冷链";

export type RateStatus = "生效中" | "已撤销";

export type QuoteStatus = "草稿" | "已发送";

export interface Customer {
  id: string;
  name: string;
  grade: CustomerGrade;
}

/** 运价版本：一条版本对应 客户等级 + 线路 + 服务 + 计费重段 在某有效期内的定价 */
export interface RateVersion {
  id: string;
  grade: CustomerGrade;
  route: string;
  service: ServiceType;
  /** 重量段下限(含), kg */
  weightMin: number;
  /** 重量段上限(含), null 表示不限 */
  weightMax: number | null;
  /** 单价 元/kg */
  unitPrice: number;
  /** 起步价 元/票 */
  baseFee: number;
  /** 燃油附加费率, 0.08 = 8% */
  fuelRate: number;
  /** 生效日 YYYY-MM-DD */
  validFrom: string;
  /** 失效日 YYYY-MM-DD */
  validTo: string;
  currency: string;
  status: RateStatus;
  createdAt: string;
  revokedAt: string | null;
  revokeReason: string | null;
}

/** 报价发送/修订时冻结的快照 */
export interface QuoteSnapshot {
  rateVersionId: string;
  /** 冻结瞬间运价版本状态, 恒为 生效中 */
  rateStatusAtFreeze: RateStatus;
  grade: CustomerGrade;
  route: string;
  service: ServiceType;
  chargeableWeight: number;
  unitPrice: number;
  baseFee: number;
  fuelRate: number;
  baseFreight: number;
  fuelSurcharge: number;
  totalAmount: number;
  currency: string;
  /** 报价有效期起 */
  validFrom: string;
  /** 报价有效期止 */
  validTo: string;
  frozenAt: string;
  /** 快照指纹, 任一冻结字段被改动都会核对失败 */
  fingerprint: string;
}

export interface QuoteRevision {
  revisionNo: number;
  reason: string;
  createdAt: string;
  snapshot: QuoteSnapshot;
}

export interface Quote {
  id: string;
  /** 可读报价单号, 如 Q-20260919-001 */
  quoteNo: string;
  customerId: string;
  customerName: string;
  grade: CustomerGrade;
  route: string;
  service: ServiceType;
  /** 当前(最新修订)计费重, 历史计费重以各版快照为准 */
  chargeableWeight: number;
  remark: string;
  status: QuoteStatus;
  revisions: QuoteRevision[];
  createdAt: string;
  sentAt: string | null;
}

export interface DeskState {
  customers: Customer[];
  rates: RateVersion[];
  quotes: Quote[];
}

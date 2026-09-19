export type ServiceType = "标准达" | "次日达" | "冷链";
export type CustomerGrade = "战略客户" | "重点客户" | "普通客户";
export type RateStatus = "生效中" | "已撤销";
export type QuoteStatus = "草稿" | "已发送" | "已修订" | "已关闭";

/** 运价版本：同一合同维度下按版本管理，生效区间重叠时新版本会顶替旧版本 */
export interface RateVersion {
  id: string;
  code: string;
  grade: CustomerGrade;
  route: string;
  service: ServiceType;
  /** 重量区间下限(含), kg */
  minWeight: number;
  /** 重量区间上限(含), kg; null 表示不限 */
  maxWeight: number | null;
  /** 单价 元/kg */
  unitPrice: number;
  /** 燃油附加费率(按运费计), 如 0.09 表示 9% */
  fuelRate: number;
  /** 最低收费 元 */
  minCharge: number;
  /** 生效日期 yyyy-mm-dd */
  effectiveFrom: string;
  /** 失效日期 yyyy-mm-dd, null 表示长期有效 */
  effectiveTo: string | null;
  /** 报价默认有效期天数, 生成报价时冻结为具体日期 */
  quoteValidDays: number;
  status: RateStatus;
  createdAt: string;
  revokedAt: string | null;
  revokeReason: string | null;
  /** 换版顶替链: 当前版本顶替了哪个旧版本 */
  supersedesId: string | null;
  note: string;
}

export interface Customer {
  id: string;
  name: string;
  grade: CustomerGrade;
}

/** 发送报价时冻结的运价快照，历史报价永远以此核对 */
export interface QuoteSnapshot {
  rateVersionId: string;
  rateCode: string;
  unitPrice: number;
  fuelRate: number;
  minCharge: number;
  baseFreight: number;
  fuelSurcharge: number;
  totalAmount: number;
  currency: "CNY";
}

export interface QuoteInput {
  customerId: string;
  route: string;
  weight: number;
  service: ServiceType;
}

export interface QuoteRecord extends QuoteInput {
  id: string;
  quoteNo: string;
  status: QuoteStatus;
  validFrom: string | null;
  validTo: string | null;
  snapshot: QuoteSnapshot | null;
  note: string;
  createdAt: string;
  sentAt: string | null;
  /** 修订链: 根报价 id(首版等于自身 id) */
  rootId: string;
  /** 修订链序号, 首版为 1 */
  revisionNo: number;
  /** 本版由哪个报价修订而来 */
  parentId: string | null;
  revisionReason: string | null;
  closedReason: string | null;
}

export interface AppState {
  customers: Customer[];
  rates: RateVersion[];
  quotes: QuoteRecord[];
  seq: { rate: number; quote: number };
}

export interface MatchInput {
  grade: CustomerGrade;
  route: string;
  service: ServiceType;
  weight: number;
  /** 发版/报价日期 yyyy-mm-dd, 默认今天 */
  onDate: string;
}

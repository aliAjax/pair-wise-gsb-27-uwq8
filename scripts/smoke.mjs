/* eslint-disable no-console */
// 纯 node 冒烟测试：esbuild 打包后执行，验证核心业务闭环
import assert from "node:assert";
import { createPinia, setActivePinia } from "pinia";

// 浏览器 localStorage 内存垫片
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
};
import { useDeskStore } from "../src/store";

setActivePinia(createPinia());
const store = useDeskStore();

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

// 1. 匹配：战略客户 上海-南京 标准达 180kg -> rv-002 大货价
const pv = store.preview({
  customerId: "c-haiwo",
  route: "上海-南京",
  weight: 180,
  service: "标准达",
});
ok("命中大货段版本 rv-002", pv.rate.id === "rv-002");
ok("基础运费 180*5.8=1044", pv.snapshot.baseFreight === 1044);
ok("燃油 1044*9%=93.96", pv.snapshot.fuelSurcharge === 93.96);
ok("总额冻结 1137.96", pv.snapshot.totalAmount === 1137.96);
ok("有效期 7 天", pv.validTo !== pv.validFrom);

// 小票段走 rv-001 + 最低收费
const pvSmall = store.preview({
  customerId: "c-haiwo",
  route: "上海-南京",
  weight: 10,
  service: "标准达",
});
ok("小票段命中 rv-001", pvSmall.rate.id === "rv-001");
ok("最低收费 120 兜底 (10*6.5=65 -> 120)", pvSmall.snapshot.baseFreight === 120);

// 2. 无适用版本阻止：维度不存在
let blocked = "";
try {
  store.preview({ customerId: "c-haiwo", route: "北京-火星", weight: 100, service: "标准达" });
} catch (e) {
  blocked = e.message;
}
ok("无维度时阻止发送", blocked.includes("不存在"));

// 3. 未到生效日阻止：深圳-成都 rv-006 七天后才生效
blocked = "";
try {
  store.preview({ customerId: "c-haiwo", route: "深圳-成都", weight: 100, service: "次日达" });
} catch (e) {
  blocked = e.message;
}
ok("未到生效日阻止发送", blocked.includes("不在有效期"));

// 4. 发送并冻结
const q1 = store.sendQuote(
  { customerId: "c-yuncang", route: "杭州-合肥", weight: 120, service: "冷链" },
  "测试单"
);
ok("发送后为已发送", q1.status === "已发送");
ok("发送即冻结快照", q1.snapshot?.totalAmount === 120 * 8.6 * 1.1);
const frozenTotal = q1.snapshot.totalAmount;

// 5. 未填原因不能修订
let err = "";
try {
  store.reviseQuote(q1.id, {
    customerId: "c-yuncang",
    route: "杭州-合肥",
    weight: 120,
    service: "冷链",
  }, "  ", "");
} catch (e) {
  err = e.message;
}
ok("修订必须填原因", err.includes("原因"));

// 6. 带原因修订 -> 原报价不可覆盖
const before = store.quotes.find((x) => x.id === q1.id);
const q1SnapshotBefore = JSON.stringify(before.snapshot);
const q1ValidBefore = before.validTo;
const r1 = store.reviseQuote(
  q1.id,
  { customerId: "c-yuncang", route: "杭州-合肥", weight: 150, service: "冷链" },
  "计费重由120调整为150",
  "重算"
);
const after = store.quotes.find((x) => x.id === q1.id);
ok("修订生成新版本号 BJ-...-R2", /-R2$/.test(r1.quoteNo));
ok("原报价快照（单价/燃油/总额）未被覆盖", JSON.stringify(after.snapshot) === q1SnapshotBefore);
ok("原报价有效期未被覆盖", after.validTo === q1ValidBefore);
ok("原报价计费重未被覆盖", after.weight === 120);
ok("原报价置为已修订", after.status === "已修订");
ok("新修订金额按新重量冻结", r1.snapshot.totalAmount !== frozenTotal);
ok("已发送状态不可再修订", (() => {
  try {
    store.reviseQuote(q1.id, { customerId: "c-yuncang", route: "杭州-合肥", weight: 1, service: "冷链" }, "x", "");
    return false;
  } catch {
    return true;
  }
})());

// 7. 报价链完整
const chain = store.chainOf(q1.rootId);
ok("报价链含首版+修订共2版", chain.length === 2 && chain[0].revisionNo === 1 && chain[1].revisionNo === 2);

// 8. 已发送报价不可删除
err = "";
try {
  store.removeQuote(q1.id);
} catch (e) {
  err = e.message;
}
ok("已发送报价不可删除", err.includes("不可删除"));

// 9. 撤销运价版本：新报价被阻止，历史报价按快照核对
store.revokeRate("rv-004", "合同终止");
blocked = "";
try {
  store.preview({ customerId: "c-yuncang", route: "杭州-合肥", weight: 50, service: "冷链" });
} catch (e) {
  blocked = e.message;
}
ok("撤销后新报价被阻止", blocked.includes("均已撤销"));

const checkV4 = store.check(r1);
ok("撤销后历史报价仍可按快照核对（状态 revoked）", checkV4.state === "revoked");
ok("核对金额仍等于冻结总额", Math.abs(r1.snapshot.totalAmount - 150 * 8.6 * 1.1) < 0.005);

// 历史 rv-003 报价（种子 q-0003）
const seedQ = store.quotes.find((q) => q.id === "q-0003");
ok("种子历史单引用已撤销版本", store.check(seedQ).state === "revoked");

// 被引用的版本不允许删除
err = "";
try {
  store.deleteRate("rv-004");
} catch (e) {
  err = e.message;
}
ok("被报价引用的版本不可删除", err.includes("已被报价引用"));

// 10. 换版：今日建档新版顶替 rv-002，旧版有效期截断但仍可核对快照
const futureDate = new Date().toISOString().slice(0, 10);
const nv = store.addRate({
  grade: "战略客户",
  route: "上海-南京",
  service: "标准达",
  minWeight: 100.01,
  maxWeight: null,
  unitPrice: 6.1,
  fuelRate: 0.08,
  minCharge: 600,
  effectiveFrom: futureDate,
  effectiveTo: null,
  quoteValidDays: 10,
  note: "新年度价",
});
ok("新版本记录顶替关系 supersedesId", nv.supersedesId === "rv-002");
const old = store.rateById("rv-002");
ok("被顶替旧版本有效期截断到新版前一天", old.effectiveTo !== null && old.effectiveTo < futureDate);
// 种子报价 q-0002 用 rv-002 @200kg；今日换版后核对显示漂移但冻结金额不变
const seedQ2 = store.quotes.find((q) => q.id === "q-0002");
const check2 = store.check(seedQ2);
ok("换版后历史报价核对为 drift", check2.state === "drift");
ok("漂移指向现行新版本", check2.currentRate?.id === nv.id);
ok("漂移时报价冻结总额不变", seedQ2.snapshot.totalAmount === 1264.4);

// 同链首版 q-0001 也引用 rv-002，今日同样标记漂移但其自身快照不变
const seedQ1 = store.quotes.find((q) => q.id === "q-0001");
ok("同链旧版也显示换版漂移", store.check(seedQ1).state === "drift");
ok("小票段 rv-001 未被顶替（重量区间不重叠）", store.rateById("rv-001").effectiveTo === null);

// 11. 草稿流程：无运价也能存草稿；发送时匹配失败会报错
const d = store.saveDraft({ customerId: "c-dongjun", route: "北京-天津", weight: 30, service: "标准达" }, "草");
ok("无匹配也可存草稿", d.status === "草稿" && d.snapshot === null);
err = "";
try {
  store.sendDraft(d.id);
} catch (e) {
  err = e.message;
}
ok("草稿发送时无版本同样被阻止", err.includes("不存在"));

console.log(`\n全部 ${passed} 项断言通过 ✅`);

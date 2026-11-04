import test from "node:test";
import assert from "node:assert/strict";
import { priceQuotes, pickBest, calculate } from "../dist/hunt/pricing.js";
import { fixture, offer, compatibility, gbp } from "./fixtures/hunt.mjs";
test("synthetic Nike separates guaranteed, conditional, cashback and budgets", () => {
  const quote = priceQuotes(fixture())[0];
  assert.equal(quote.guaranteed.amount.pence, 7000);
  assert.equal(quote.conditional[0].payToday.amount.pence, 6300);
  assert.deepEqual(quote.conditional[0].requires, ["verify-student"]);
  assert.equal(quote.conditional[0].budget.by.pence, 300);
  assert.equal(quote.backLater[0].value.pence, 190);
  const missing = fixture(); missing.offers = missing.offers.filter(o => o.kind !== "delivery"); missing.compatibility = [];
  assert.equal(priceQuotes(missing)[0].guaranteed.kind, "unknown");
  assert.equal(priceQuotes(missing)[0].budget.kind, "unknown");
});
test("exact complete sets, dangling IDs and unsupported selections", () => {
  const f = fixture(), [p,d] = f.offers;
  const a = offer("a", "discount", { adjustment: { kind: "fixed", amount: gbp(2000) } });
  const b = offer("b", "discount", { adjustment: { kind: "fixed", amount: gbp(3000) } });
  const c = offer("c", "discount", { adjustment: { kind: "fixed", amount: gbp(4000) } });
  f.offers = [p,d,a,b,c]; f.compatibility = [compatibility(p,d,a,b), compatibility(p,d,b,c), compatibility(p,d,a,c)];
  assert.equal(priceQuotes(f)[0].guaranteed.amount.pence, 0);
  assert.equal(priceQuotes(f)[0].selection.benefits.length, 2);
  f.compatibility = [compatibility(p,d,a), compatibility(p,d,b), compatibility(p,d,c)];
  assert.equal(priceQuotes(f)[0].guaranteed.amount.pence, 3000);
  assert.throws(() => priceQuotes({ ...f, selection: { price: p.id, delivery: d.id, benefits: [a.id,b.id] } }), /Unsupported/);
  assert.throws(() => priceQuotes({ ...f, compatibility: [{ offers: [p.id,"missing"], proof: [p.proof] }] }), /Dangling/);
  assert.throws(() => priceQuotes({ ...f, compatibility: [{ offers: [p.id,d.id,a.id], proof: [] }] }));
  assert.throws(() => priceQuotes({ ...f, offers: [p,d,{...a,seller:"other"}], compatibility: [compatibility(p,d,a)] }), /Mismatched/);
  assert.throws(() => priceQuotes({ ...f, offers: [p,d,{...a,variant:"UK 7"}], compatibility: [] }), /variant/);
});
test("independent exhaustive subset oracle over deterministic small inputs", () => {
  for (let seed = 1; seed <= 12; seed++) {
    const f = fixture(), [p,d] = f.offers;
    const benefits = Array.from({length:6}, (_, i) => offer(`b${i}`, "discount", { adjustment: {kind:"fixed",amount:gbp((seed * 97 + i * 233) % 1300)}, minimumSpend: gbp(i === 5 ? 8000 : 0) }));
    let expected = 7000; const proofs = [];
    for (let mask = 1; mask < 64; mask++) {
      if ((mask + seed) % 3 === 0) continue;
      const subset = benefits.filter((_,i) => mask & 2 ** i);
      proofs.push(compatibility(p,d,...subset));
      if (subset.some(o => o.minimumSpend.pence > 7000)) continue;
      expected = Math.min(expected, Math.max(0, 7000 - subset.reduce((sum,o) => sum + o.adjustment.amount.pence,0)));
    }
    assert.equal(priceQuotes({...f,offers:[p,d,...benefits],compatibility:proofs})[0].guaranteed.amount.pence,expected);
  }
});
test("order, floor rounding, basis, minimum spend, unknowns and overflow", () => {
  const p=offer("p","price",{amount:gbp(101)}), d=offer("d","delivery",{amount:gbp(7)});
  const a=offer("a","discount",{adjustment:{kind:"fixed",amount:gbp(1)},order:0});
  const b=offer("b","discount",{adjustment:{kind:"percent",basisPoints:5000,basis:"remaining"},order:1});
  assert.equal(calculate(p,d,[b,a]).amount.pence,57);
  assert.equal(calculate(p,d,[{...b,adjustment:{...b.adjustment,basis:"delivery"}}]).amount.pence,105);
  assert.throws(() => calculate(p,d,[{...a,minimumSpend:gbp(102)}]),/Minimum/);
  assert.throws(() => calculate({...p,amount:gbp(Number.MAX_SAFE_INTEGER)},d,[]),/overflow/);
  const f=fixture(); const code=offer("code","discount",{status:{kind:"untested"}});
  assert.equal(priceQuotes({...f,offers:[...f.offers,code]})[0].guaranteed.amount.pence,7000);
  assert.equal(priceQuotes({...f,offers:[...f.offers,code]})[0].untested.length,1);
  const over=priceQuotes({...f,offers:[...f.offers.slice(0,2),...Array.from({length:17},(_,i)=>offer(`b${i}`,"discount"))],compatibility:[]});
  assert.match(over[0].limitations[0],/16/); assert.equal(pickBest(over),null);
});

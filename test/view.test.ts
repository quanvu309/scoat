import test from "node:test";
import assert from "node:assert/strict";
import { renderView, finishable } from "../dist/hunt/view.js";
import { priceQuotes } from "../dist/hunt/pricing.js";
import { fixture, rows, viewArgs, release, offer, gbp } from "./fixtures/hunt.mjs";
test("one view retains eight rows, four seller slots, gaps, clean links and lifecycle directives", () => {
  const args=viewArgs(priceQuotes(fixture())); const view=renderView(args);
  assert.equal(finishable([], release, "nike").ok, false);
  assert.equal(view.rows.length,8); assert.equal(view.rows.find(r=>r.row.place==="other-sellers").slots.length,4);
  assert.equal(view.progress.resolved,8); assert.equal(view.directive.kind,"finish");
  assert.equal(view.ready.url,"https://www.nike.com/gb/t/synthetic"); assert.match(view.text,/GBP 63.00 requires verify-student/);
  const incomplete=rows(); const other=incomplete.find(r=>r.row.place==="other-sellers"); other.slots.pop();
  assert.equal(finishable(incomplete, release, "nike").ok,false);
  const stopped=renderView({...args,rows:incomplete,stopRequested:true});
  assert.match(stopped.gaps.join(),/slot-3/); assert.match(stopped.text,/slot-3/); assert.equal(stopped.directive.kind,"name-gaps-and-finish");
  other.slots[1].seller=other.slots[0].seller; assert.equal(finishable(incomplete, release, "nike").ok,false);
  other.skippedBy="person"; assert.equal(finishable(incomplete, release, "nike").ok,true);
  assert.equal(renderView({...args,final:{kind:"finished",quote:view.best}}).directive.kind,"complete");
  assert.throws(()=>renderView({...args,rows:args.rows.slice(1)}),/eight/);
});

test("coverage requires the exact slots and four distinct sellers other than the original shop", () => {
  for (const seller of ["nike", " NIKE ", " SELLER-1 ", " "]) {
    const current = rows();
    current.find(row => row.row.place === "other-sellers").slots[0].seller = seller;
    const view = renderView({ ...viewArgs([]), rows: current });
    assert.equal(view.progress.resolved,7);
    assert.match(view.gaps.join(),/distinct seller/);
  }
  const current = rows(), other = current.find(row => row.row.place === "other-sellers");
  other.slots.push({slot:4,seller:null,completion:{kind:"pending"}});
  assert.equal(finishable(current,release,"nike").ok,false);
  assert.match(renderView({...viewArgs([]),rows:current}).gaps.join(),/slot-4: unexpected/);
  other.slots.pop();
  other.slots[0] = {slot:0,seller:null,completion:{kind:"gap",reason:"Seller search blocked"}};
  assert.equal(finishable(current,release,"nike").ok,true);
  other.skippedBy = "person";
  assert.equal(finishable(current,release,"nike").ok,true);
});

test("one projection retains losing, unknown and limited quote scenarios for every renderer", () => {
  const f = fixture();
  const rival = offer("rival-price","price",{seller:"rival",amount:gbp(8500)});
  const delivery = offer("rival-delivery","delivery",{seller:"rival",amount:gbp(0)});
  const known = priceQuotes({...f,offers:[...f.offers,rival,delivery]});
  const unknown = priceQuotes({...f,offers:f.offers.filter(o=>o.kind!=="delivery"),compatibility:[]});
  const limited = priceQuotes({...f,offers:[...f.offers.slice(0,2),...Array.from({length:17},(_,i)=>offer(`limited-${i}`,"discount"))],compatibility:[]});
  const quotes = [...known,...unknown,...limited];
  const view = renderView(viewArgs(quotes));
  assert.deepEqual(view.quotes,quotes);
  assert.match(view.text,/rival: guaranteed GBP 85.00/);
  assert.match(view.gaps.join(),/delivery/);
  assert.match(view.gaps.join(),/benefit-limit-exceeded/);
  assert.equal(view.quotes.find(q=>q.seller==="rival").guaranteed.amount.pence,8500);
  assert.equal(view.quotes.filter(q=>q.guaranteed.kind==="unknown").length,1);
});

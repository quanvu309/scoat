import test from "node:test";
import assert from "node:assert/strict";
import { parseEvidence, checkEvidence, assertRecordAllowed, offerInputSchema } from "../dist/hunt/evidence.js";
import { priceQuotes } from "../dist/hunt/pricing.js";
import { fixture, intent, now, offer, gbp, release, officialRelease, proof, compatibility } from "./fixtures/hunt.mjs";
test("strict evidence rejects unsafe money, stale/future/expired sources and scope mismatches", () => {
  const { id, row, ...valid } = fixture().offers[0];
  const context = { intent, seller: "nike", now, release };
  assert.equal(parseEvidence(valid, context).kind, "price");
  for (const pence of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity]) assert.throws(() => parseEvidence({ ...valid, amount: gbp(pence) }, context));
  for (const url of ["http://nike.com", "https://127.0.0.1", "https://localhost", "https://host.internal"]) assert.throws(() => parseEvidence({ ...valid, proof: { ...valid.proof, url } }, context));
  for (const observedAt of ["not-time", "2026-11-05T00:00:00Z", "2026-11-02T00:00:00Z"]) assert.throws(() => parseEvidence({ ...valid, proof: { ...valid.proof, observedAt } }, context));
  for (const patch of [{ variant: "UK 7" }, { seller: "other" }, { validUntil: now }, { total: 0 }]) assert.throws(() => parseEvidence({ ...valid, ...patch }, context));
  assert.throws(() => offer("bad", "discount", { adjustment: { kind: "percent", basisPoints: 10001, basis: "item" } }));
  assert.throws(() => offerInputSchema.parse({ ...valid, kind: "price", skippedBy: "person" }));
});
test("Stop rejects found including correction and permits named gaps", () => {
  assert.throws(() => assertRecordAllowed(true, { kind: "found", correction: true }), /Stop/);
  assert.doesNotThrow(() => assertRecordAllowed(true, { kind: "gap" }));
});

test("code provenance never upgrades a lead into a verified discount", () => {
  const context = { intent, seller: "nike", now, release };
  const raw = offer("code", "discount", { code: "SYNTHETIC", codeOrigin: "lead" });
  const {id,row,...input}=raw;
  assert.throws(()=>parseEvidence(input,context),/untested/);
  assert.equal(parseEvidence({...input,status:{kind:"untested"}},context).status.kind,"untested");
});

test("retailer-tested labels require the pinned release's official source authority", () => {
  const base = fixture(), [price, delivery] = base.offers;
  const authority = officialRelease();
  const code = offer("official-code", "discount", { code: "SYNTHETIC", codeOrigin: "retailer-tested", adjustment: { kind: "fixed", amount: gbp(1000) } });
  const context = { intent, now, release: authority, row: authority.rows[0] };
  const input = ({id,row,...value}) => value;
  assert.equal(checkEvidence({ ...context, offer: input(code) }).ok, true);
  for (const url of ["https://coupons.com/nike", "https://www.nike.com.attacker.com/code"]) {
    const forged = { ...code, proof: { ...proof, url } };
    assert.equal(checkEvidence({ ...context, offer: input(forged) }).ok, false);
    assert.throws(() => priceQuotes({ ...base, release: authority, offers: [price, delivery, forged], compatibility: [compatibility(price, delivery, forged)] }), /official retailer source/);
  }
  assert.equal(checkEvidence({ ...context, release, offer: input(code) }).ok, false);
  assert.equal(priceQuotes({ ...base, release: authority, offers: [price, delivery, code], compatibility: [compatibility(price, delivery, code)] })[0].guaranteed.amount.pence, 6000);
  assert.equal(checkEvidence({ ...context, now: "2026-12-01T00:00:00Z", offer: input({ ...code, proof: { ...proof, observedAt: "2026-12-01T00:00:00Z" } }) }).ok, false);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { readDelivery, readProduct, pihut } from "../dist/delivery/pihut.js";
import { publicAddress } from "../dist/delivery/fetch.js";
import { basisDigest } from "../dist/delivery/index.js";
import { resolveWatchTarget, signUnsubscribe, readUnsubscribe, alertMessage, maskAddress } from "../dist/memory/watches.js";

const recording = (name: string) => gunzipSync(readFileSync(new URL("../fixtures/sellers/pihut/" + name, import.meta.url)));
const product = recording("product-2026-11-05.html.gz"), delivery = recording("delivery-2026-11-05.html.gz");
const four = 42531604922563, eight = 42531604955331, one = 55037260890497;
const marker = "_BISConfig.product = ";
const inProduct = (html: string, edit: (segment: string) => string) => { const start = html.indexOf(marker); return html.slice(0, start) + edit(html.slice(start)); };
const editPrice = (html: string, variant: number, pence: number) => inProduct(html, segment => segment.replace(new RegExp(`("id":${variant},[^{}]*?"price":)\\d+`), "$1" + pence));

test("recordings match their provenance digests and the named parser reads exact variants", () => {
 const manifest = JSON.parse(readFileSync(new URL("../fixtures/sellers/pihut/provenance.json", import.meta.url), "utf8"));
 assert.equal(createHash("sha256").update(product).digest("hex"), manifest.recordings[0].sha256);
 assert.equal(createHash("sha256").update(delivery).digest("hex"), manifest.recordings[1].sha256);
 assert.deepEqual(readProduct(product.toString("utf8"), four), { kind: "ok", pence: 10560, sku: "SC1431" });
 assert.deepEqual(readProduct(product.toString("utf8"), eight), { kind: "ok", pence: 16800, sku: "SC1432" });
 assert.deepEqual(readProduct(product.toString("utf8"), one), { kind: "unknown", reason: "unavailable" });
 assert.deepEqual(readDelivery(delivery.toString("utf8")), { kind: "ok", pence: 380 });
});

test("changed, ambiguous, conditional or non-GBP pages are unknown", () => {
 const html = product.toString("utf8");
 assert.deepEqual(readProduct(html, 123), { kind: "unknown", reason: "variant-changed" });
 assert.deepEqual(readProduct(inProduct(html, segment => segment.replace('"sku":"SC1431"', '"sku":"SC9999"')), four), { kind: "unknown", reason: "variant-changed" });
 assert.deepEqual(readProduct(html.replace('Shopify.currency = {"active":"GBP"', 'Shopify.currency = {"active":"EUR"'), four), { kind: "unknown", reason: "currency-not-gbp" });
 assert.deepEqual(readProduct(html.replace("_BISConfig.product = ", "_BISConfig.product = {\"x\":1};_BISConfig.product = "), four), { kind: "unknown", reason: "product-format-changed" });
 assert.deepEqual(readProduct(inProduct(html, segment => segment.replace(new RegExp(`("id":${four},[^{}]*?"selling_plan_allocations":)\\[\\]`), "$1[{}]")), four), { kind: "unknown", reason: "conditional-pricing" });
 assert.deepEqual(readProduct(inProduct(html, segment => segment.replace(new RegExp(`("id":${four},[^{}]*?"available":)true`), "$1false")), four), { kind: "unknown", reason: "unavailable" });
 assert.deepEqual(readProduct(html.replace('<link rel="canonical" href="https://thepihut.com/products/raspberry-pi-5"', '<link rel="canonical" href="https://thepihut.com/products/raspberry-pi-4"'), four), { kind: "unknown", reason: "product-format-changed" });
 const text = delivery.toString("utf8");
 const inUk = (edit: (segment: string) => string) => { const start = text.indexOf('id="UnitedKingdom">'); return text.slice(0, start) + edit(text.slice(start)); };
 assert.deepEqual(readDelivery(inUk(segment => segment.replace("£3.80", "Free"))), { kind: "unknown", reason: "delivery-rule-changed" });
 assert.deepEqual(readDelivery(inUk(segment => segment.replace("1st Class", "2nd Class"))), { kind: "unknown", reason: "delivery-rule-changed" });
 assert.deepEqual(readDelivery(text.replace('id="UnitedKingdom">', 'id="UK">')), { kind: "unknown", reason: "delivery-rule-changed" });
 assert.deepEqual(readDelivery(inUk(segment => segment.replace("£3.80", "£4.10"))), { kind: "ok", pence: 410 });
 assert.deepEqual(readProduct(editPrice(html, four, 6620), four), { kind: "ok", pence: 6620, sku: "SC1431" });
});

test("public address policy blocks private, mapped-private and special ranges without blocking public IPv4", () => {
 for (const address of ["127.0.0.1", "10.1.2.3", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "::", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1", "::ffff:a9fe:a9fe", "64:ff9b::7f00:1", "2002:7f00:1::1", "::127.0.0.1", "not-an-ip"]) assert.equal(publicAddress(address), false, address);
 for (const address of ["93.184.216.34", "151.101.1.1", "2606:4700::1111", "::ffff:93.184.216.34", "::ffff:5db8:d822"]) assert.equal(publicAddress(address), true, address);
});

test("watch targets need one exact supported variant and personalized totals never become a baseline", () => {
 assert.deepEqual(resolveWatchTarget({ quotes: [{ url: "https://thepihut.com/products/raspberry-pi-5?variant=" + four, conditional: [{ payToday: { pence: 6300 } }] }] }).kind, "target");
 assert.equal(resolveWatchTarget({ url: "https://thepihut.com/products/raspberry-pi-5" }).kind, "unavailable");
 assert.deepEqual(resolveWatchTarget({ a: "https://thepihut.com/products/raspberry-pi-5?variant=" + four, b: "https://thepihut.com/products/raspberry-pi-5?variant=" + eight }), { kind: "unavailable", reason: "ambiguous-variant" });
 assert.equal(resolveWatchTarget({ url: "https://seller-a.example.com/p?variant=" + four }).kind, "unavailable");
 const target = resolveWatchTarget({ url: "https://thepihut.com/products/raspberry-pi-5?variant=" + four });
 assert.ok(target.kind === "target" && !JSON.stringify(target.target).includes("6300"));
});

test("unsubscribe tokens are signed, versioned and non-PII; alert content names price, basis, source time, shop and conditions", () => {
 const config = { issuer: "https://scoat.example", from: "alerts@scoat.example", unsubscribe: { version: "v1", keys: { v1: "a".repeat(64), v0: "b".repeat(64) } }, resendApiKey: null };
 const scope = { account: "11111111-1111-4111-8111-111111111111", incarnation: "22222222-2222-4222-8222-222222222222" };
 const token = signUnsubscribe(config, "v1", scope, "33333333-3333-4333-8333-333333333333");
 assert.deepEqual(readUnsubscribe(config, token), { ...scope, watch: "33333333-3333-4333-8333-333333333333" });
 assert.equal(readUnsubscribe(config, token.slice(0, -2) + "AA"), null);
 assert.equal(readUnsubscribe({ ...config, unsubscribe: { version: "v1", keys: { v1: "c".repeat(64) } } }, token), null);
 assert.ok(!Buffer.from(token.split(".")[0], "base64url").toString().includes("@"));
 const target = { parser: pihut.parser, seller: pihut.seller, url: pihut.product, variant: four, sku: "SC1431", quantity: 1, delivery: { destination: "GB", service: pihut.service, rule: pihut.rule, lithium: false, membership: "none" } };
 const observation = { kind: "comparable", basis: { url: pihut.product, seller: pihut.seller, variant: four, sku: "SC1431", currency: "GBP", availability: "in-stock", delivery: { destination: "GB", service: pihut.service, rule: pihut.rule } }, itemPence: 5620, deliveryPence: 380, amountPence: 6000, proof: { product: "0".repeat(64), delivery: "1".repeat(64) } } as const;
 const message = alertMessage(config, target, observation, new Date("2026-11-05T00:05:00Z"), 7000, 6000, "https://scoat.example/watch/unsubscribe?token=" + token);
 for (const part of ["GBP 60.00", "GBP 56.20", "GBP 3.80", "2026-11-05T00:05:00.000Z", "https://thepihut.com/products/raspberry-pi-5?variant=" + four, "Conditions", "/watch/unsubscribe?token="]) assert.ok(message.text.includes(part), part);
 assert.equal(message.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
 assert.equal(maskAddress("person@example.com"), "p***@example.com");
 assert.equal(basisDigest(observation).length, 64);
 assert.ok(gzipSync(product).length > 0);
});

import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { Delivery } from "../dist/delivery/index.js";

test("mail acceptance requires the declared provider response shape", async () => {
 let body = { id: "mail-1" };
 const server = createServer((req, res) => {
  req.resume();
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
 });
 server.listen(0, "127.0.0.1");
 await once(server, "listening");
 try {
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const delivery = new Delivery({ resolve: async () => { throw new Error("Mail submission does not resolve seller pages"); }, mail: { origin: `http://127.0.0.1:${address.port}`, apiKey: "local-contract" } });
  const message = { from: "alerts@example.test", subject: "Watch alert", text: "Price changed", html: "<p>Price changed</p>", headers: {} };
  const submit = () => delivery.submit(message, "person@example.test", "stable-alert-key", AbortSignal.timeout(1000));
  assert.deepEqual(await submit(), { kind: "accepted", id: "mail-1" });
  body = { id: "mail-1", undeclared: true };
  assert.deepEqual(await submit(), { kind: "ambiguous", reason: "status-200" });
  body = { id: "" };
  assert.deepEqual(await submit(), { kind: "ambiguous", reason: "status-200" });
 } finally {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
 }
});

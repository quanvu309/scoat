import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { parse } from "parse5";
import { sendPage, pageHead, refusalPage } from "../dist/browser/page.js";
import { consent, enroll, link } from "../dist/browser/views.js";

function elements(html) {
 const result = [];
 function visit(node) { result.push(node); for (const child of node.childNodes ?? []) visit(child); }
 visit(parse(html));
 return result;
}
test("browser HTTP outcomes preserve refusal status, protected headers and a usable document", async () => {
 const server = createServer((req, res) => { pageHead(res, 403, { "set-cookie": ["flow=bound; Secure; HttpOnly"] }); sendPage(res, refusalPage()); });
 await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
 try {
  const response = await fetch(`http://127.0.0.1:${server.address().port}`);
  const html = await response.text();
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("referrer-policy"), "same-origin");
  assert.equal(response.headers.get("set-cookie"), "flow=bound; Secure; HttpOnly");
  const style = /<style>([\s\S]+?)<\/style>/.exec(html)[1];
  assert.ok(response.headers.get("content-security-policy").includes("style-src 'sha256-" + createHash("sha256").update(style).digest("base64") + "'"));
  const nodes = elements(html);
  assert.equal(nodes.filter(node => node.tagName === "main").length, 1);
  assert.equal(nodes.filter(node => node.tagName === "h1").length, 1);
  assert.ok(html.includes("fresh Scoat link"));
 } finally { await new Promise(resolve => server.close(resolve)); }
});
test("consent describes only requested access and keeps both explicit decisions", () => {
 const html = consent({ params: { scope: "openid scoat:read" } }, 'csrf<"&', { name: '<script>bad</script>', origin: "https://chat.example" });
 const nodes = elements(html);
 assert.equal(nodes.filter(node => node.tagName === "script").length, 0);
 assert.ok(html.includes("View your hunts and saved shopping results"));
 assert.ok(!html.includes("Run hunts and save changes"));
 const buttons = nodes.filter(node => node.tagName === "button");
 assert.deepEqual(buttons.map(node => node.attrs.find(attr => attr.name === "value").value), ["allow", "deny"]);
 const csrf = nodes.find(node => node.tagName === "input");
 assert.equal(csrf.attrs.find(attr => attr.name === "value").value, 'csrf<"&');
});
test("enrollment and linking keep browser-bound native confirmations", () => {
 for (const [view, action] of [[enroll, "/account/enroll"], [link, "/account/link"]]) {
  const nodes = elements(view("bound-confirmation"));
  const form = nodes.find(node => node.tagName === "form");
  assert.equal(form.attrs.find(attr => attr.name === "method").value, "post");
  assert.equal(form.attrs.find(attr => attr.name === "action").value, action);
  assert.ok(nodes.some(node => node.tagName === "input" && node.attrs.some(attr => attr.name === "value" && attr.value === "bound-confirmation")));
 }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { parse } from "parse5";
import { sendPage, pageHead, refusalPage, browserDocument } from "../dist/browser/page.js";
import { consent, enroll, link, emailEntry, emailCode } from "../dist/browser/views.js";

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
  assert.ok(html.includes("Start again"));
 } finally { await new Promise(resolve => server.close(resolve)); }
});
test("consent describes only requested access and keeps both explicit decisions", () => {
 const html = consent({ params: { scope: "openid scoat:read" } }, 'csrf<"&', { name: '<script>bad</script>', origin: "https://chat.example", refreshAllowed: true });
 const nodes = elements(html);
 assert.equal(nodes.filter(node => node.tagName === "script").length, 0);
 assert.ok(html.includes("View your hunts and saved results"));
 assert.ok(!html.includes("run hunts and save changes"));
 const buttons = nodes.filter(node => node.tagName === "button");
 assert.deepEqual(buttons.map(node => node.attrs.find(attr => attr.name === "value").value), ["allow", "deny"]);
 const csrf = nodes.find(node => node.tagName === "input");
 assert.equal(csrf.attrs.find(attr => attr.name === "value").value, 'csrf<"&');
});
test("consent distinguishes unnamed origins and keeps named hosts minimal", () => {
 const render = origin => consent({params: {scope: "openid scoat:read"}}, "csrf", {name: "your chat app", origin, refreshAllowed: false});
 const first = render("https://example.com"), second = render("https://other.example");
 assert.notEqual(first, second);
 assert.ok(first.includes('<p class="account-help">to https://example.com</p>'));
 assert.ok(second.includes('<p class="account-help">to https://other.example</p>'));
 for (const origin of ["https://chatgpt.com", "https://claude.ai"]) assert.ok(!render(origin).includes('<p class="account-help">to '));
 assert.ok(render('https://example.com/<script>"&').includes('to https://example.com/&lt;script&gt;&quot;&amp;'));
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
test("login forms preserve the production state and field contract", () => {
 const attr = (node, name) => node.attrs?.find(item => item.name === name)?.value;
 for (const html of [emailEntry({state: 'bound"state', failed: false}), emailEntry({state: 'bound"state', failed: true}), emailCode({state: 'bound"state', invalid: false}), emailCode({state: 'bound"state', invalid: true})]) {
  const nodes = elements(html);
  assert.ok(nodes.some(node => attr(node, "name") === "state" && attr(node, "value") === 'bound"state'));
  assert.ok(!nodes.some(node => ["csrf", "challenge"].includes(attr(node, "name"))));
  for (const form of nodes.filter(node => node.tagName === "form")) {
   assert.equal(attr(form, "method"), "post");
   assert.ok(["/login/send", "/login/complete"].includes(attr(form, "action")));
  }
 }
});

test("browser documents preserve task headings independently of browser titles", () => {
 const html = browserDocument("<title>Confirm Scoat price watch</title><h1>Confirm price watch</h1><p>Review this watch.</p>");
 assert.ok(html.includes("<title>Confirm Scoat price watch · Scoat</title>"));
 const headings = elements(html).filter(node => node.tagName === "h1");
 assert.equal(headings.length, 1);
 assert.equal(headings[0].childNodes[0].value, "Confirm price watch");
});

test("refresh-grant consent discloses renewal even when offline_access is dropped", () => {
 for (const scope of ["openid scoat:read scoat:write offline_access", "openid scoat:read scoat:write"]) {
  const client = {name: "ChatGPT", origin: "https://chatgpt.com", refreshAllowed: true};
  const html = consent({params: {scope}}, "bound-csrf", client);
  assert.ok(html.includes("Stays connected while you use it"));
  assert.ok(!consent({params: {scope}}, "bound-csrf", {...client, refreshAllowed: false}).includes("Stays connected"));
 }
});

test("shared headers preserve the configured OAuth callback form action", async () => {
 const server = createServer((req, res) => { pageHead(res, 200, {"content-security-policy":"default-src 'none'; form-action 'self' https://localhost:12345; frame-ancestors 'none'"}); sendPage(res, refusalPage()); });
 await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
 try {
  const response = await fetch(`http://127.0.0.1:${server.address().port}`);
  assert.ok(response.headers.get("content-security-policy").includes("form-action 'self' https://localhost:12345;"));
  assert.ok(response.headers.get("content-security-policy").includes("style-src 'sha256-"));
 } finally { await new Promise(resolve => server.close(resolve)); }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { parse } from "parse5";
import { sendPage, pageHead, refusalPage, browserDocument } from "../dist/browser/page.js";
import { connectionLifetimeSeconds } from "../dist/auth/config.js";
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
  assert.ok(html.includes("fresh Scoat link"));
 } finally { await new Promise(resolve => server.close(resolve)); }
});
test("consent describes only requested access and keeps both explicit decisions", () => {
 const html = consent({ params: { scope: "openid scoat:read" } }, 'csrf<"&', { name: '<script>bad</script>', origin: "https://chat.example", refreshAllowed: true });
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
test("email entry safely retains the address and retry action after a mail failure", () => {
 const html = emailEntry({ email: 'alex+<test>"@example.com', csrf: 'bound"csrf', action: "/future/email", state: "mail-failed" });
 const nodes = elements(html);
 const attr = (node, name) => node.attrs?.find(item => item.name === name)?.value;
 const form = nodes.find(node => node.tagName === "form");
 assert.equal(attr(form, "action"), "/future/email");
 assert.equal(attr(form, "method"), "post");
 assert.equal(attr(nodes.find(node => attr(node, "name") === "email"), "value"), 'alex+<test>"@example.com');
 assert.equal(attr(nodes.find(node => attr(node, "name") === "csrf"), "value"), 'bound"csrf');
 assert.ok(html.includes("Try sending again"));
 assert.ok(nodes.some(node => attr(node, "role") === "alert"));
 assert.ok(!nodes.some(node => node.tagName === "test"));
});
test("code states keep challenge-bound verification and resend separate", () => {
 const input = { email: "alex@example.com", csrf: "csrf-bound", challenge: "browser-bound", verifyAction: "/future/verify", resendAction: "/future/resend", changeEmailHref: "/future/email" };
 const attr = (node, name) => node.attrs?.find(item => item.name === name)?.value;
 for (const state of ["ready", "invalid", "resent", "expired", "too-many-attempts"]) {
  const nodes = elements(emailCode({ ...input, state }));
  const forms = nodes.filter(node => node.tagName === "form");
  const inactive = state === "expired" || state === "too-many-attempts";
  assert.deepEqual(forms.map(node => attr(node, "action")), inactive ? [input.resendAction] : [input.verifyAction, input.resendAction]);
  for (const form of forms) {
   assert.equal(attr(form, "method"), "post");
   assert.ok(form.childNodes.some(node => node.tagName === "input" && attr(node, "name") === "challenge" && attr(node, "value") === input.challenge));
   assert.ok(form.childNodes.some(node => node.tagName === "input" && attr(node, "name") === "csrf" && attr(node, "value") === input.csrf));
  }
  const code = nodes.find(node => attr(node, "name") === "code");
  assert.equal(Boolean(code), !inactive);
  if (code) {
   assert.equal(attr(code, "autocomplete"), "one-time-code");
   assert.equal(attr(code, "inputmode"), "numeric");
   assert.equal(attr(code, "pattern"), "[0-9]{6}");
   assert.equal(attr(code, "maxlength"), "6");
   assert.equal(attr(code, "aria-invalid"), state === "invalid" ? "true" : undefined);
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
  assert.ok(html.includes(`Stay signed in for up to ${connectionLifetimeSeconds / 86400} days`));
  assert.ok(html.includes("renew access while you’re away"));
  assert.ok(html.includes("until you disconnect or delete your account"));
  assert.ok(!consent({params: {scope}}, "bound-csrf", {...client, refreshAllowed: false}).includes("renew access"));
 }
});

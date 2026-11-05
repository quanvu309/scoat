import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createServer } from "node:http";
import { chromium } from "playwright";
import * as views from "../dist/browser/views.js";
import * as pages from "../dist/browser/page.js";
import { browserCases } from "./browser-cases.mjs";

const root = process.env.SCOAT_EVIDENCE_DIR ?? path.join(os.homedir(), "tmp/scoat-browser-ui", String(Date.now()));
await fs.mkdir(root, { recursive: true });
const mode = process.env.SCOAT_UI_BEFORE ? "before" : "after";
const beforeRoot = process.env.SCOAT_UI_BEFORE;
for (const view of Object.keys(views)) assert.ok(browserCases.some(entry => entry.view === view), `Add ${view} to scripts/browser-cases.mjs`);
const errors = [];
const server = createServer(async (req, res) => {
 try {
  const pathname = new URL(req.url, "http://localhost").pathname;
  const entry = browserCases.find(item => pathname === "/cases/" + item.id);
  if (entry) {
   if (beforeRoot) { res.setHeader("content-type", "text/html"); res.end(await fs.readFile(path.join(beforeRoot, entry.id + ".html"))); }
   else pages.sendPage(res, (views[entry.view] ?? pages[entry.view])(...entry.args));
   return;
  }
  const file = path.join(beforeRoot ? path.join(beforeRoot, "landing") : "landing/public", pathname === "/" ? "index.html" : pathname.endsWith("/") ? pathname + "index.html" : pathname);
  res.setHeader("content-type", ({ ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".woff2": "font/woff2" })[path.extname(file)] ?? "application/octet-stream");
  res.end(await fs.readFile(file));
 } catch { res.statusCode = 404; res.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const receipts = [];
try {
 for (const viewport of [{ name: "desktop", width: 1440, height: 900 }, { name: "phone", width: 390, height: 844 }]) {
  const page = await browser.newPage({ viewport });
  page.on("pageerror", error => errors.push(error.message));
  for (const entry of [...browserCases.map(item => ({ id: item.id, url: "/cases/" + item.id })), { id: "landing", url: "/" }, { id: "connect-chatgpt", url: "/connect/#chatgpt" }, { id: "connect-claude", url: "/connect/#claude" }]) {
   await page.goto("about:blank");
   const response = await page.goto(base + entry.url);
   assert.equal(response.status(), 200, entry.id);
   await page.evaluate(() => document.fonts.ready);
   const measurement = await page.evaluate(() => {
    const luminance = color => {
     const rgb = color.match(/[0-9.]+/g).slice(0, 3).map(value => Number(value) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
     return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
    };
    const lowContrastActions = document.body.classList.contains("account-page") && [...document.querySelectorAll("button, .ui-button")].some(button => {
     const style = getComputedStyle(button);
     const a = luminance(style.color), b = luminance(style.backgroundColor);
     return (Math.max(a, b) + .05) / (Math.min(a, b) + .05) < 4.5;
    });
    return { lowContrastActions,
    overflow: document.documentElement.scrollWidth > innerWidth,
    heading: document.querySelectorAll("h1").length,
    smallInputs: [...document.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]), textarea')].some(input => parseFloat(getComputedStyle(input).fontSize) < 16),
    unlabelledInputs: [...document.querySelectorAll('input:not([type="hidden"]), textarea')].filter(input => input.checkVisibility()).some(input => !input.labels?.length && !input.getAttribute("aria-label") && !input.getAttribute("aria-labelledby")),
    shortTargets: [...document.querySelectorAll("button")].filter(button => button.checkVisibility()).some(button => button.getBoundingClientRect().height < 44),
   }; });
   if (!beforeRoot) {
    assert.equal(measurement.lowContrastActions, false, entry.id + " action text contrast must be 4.5:1");
    assert.equal(measurement.overflow, false, entry.id + " horizontal overflow");
    assert.equal(measurement.heading, 1, entry.id + " one page heading");
    assert.equal(measurement.smallInputs, false, entry.id + " input text must be 16px");
    assert.equal(measurement.shortTargets, false, entry.id + " targets must be 44px");
    assert.equal(measurement.unlabelledInputs, false, entry.id + " visible inputs need labels");
    if (entry.url.startsWith("/cases/")) {
     assert.equal(response.headers()["cache-control"], "no-store");
     assert.equal(response.headers()["referrer-policy"], "same-origin");
     assert.ok(response.headers()["content-security-policy"].includes("style-src 'sha256-"));
     await page.keyboard.press("Tab");
     assert.ok(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle !== "none"));
    }
   }
   await page.evaluate(() => document.activeElement?.blur());
   const file = path.join(root, `${entry.id}-${viewport.name}.png`);
   await page.screenshot({ path: file, fullPage: true });
   receipts.push({ page: entry.id, viewport: viewport.name, ...measurement, screenshot: file });
  }
  await page.close();
 }
 assert.deepEqual(errors, []);
 await fs.writeFile(path.join(root, "receipt.json"), JSON.stringify({ status: "PASS", mode, pages: receipts, externalHosts: "UNTESTED", physicalPhone: "UNTESTED" }, null, 2));
 console.log(JSON.stringify({ status: "PASS", mode, captures: receipts.length, evidence: root }));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }

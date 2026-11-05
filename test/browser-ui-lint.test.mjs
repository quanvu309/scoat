import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { checkBrowserTokens, checkBrowserPages, checkBrowserOutcomes } from "../scripts/check-browser-ui.mjs";

const read = file => readFileSync(file, "utf8");
test("shared tokens reject the real landing's independent theme", () => {
 const tokens = read("landing/public/ui.css");
 const entries = Object.fromEntries(["landing/public/index.html", "landing/public/connect/index.html"].map(file => [file, read(file)]));
 assert.doesNotThrow(() => checkBrowserTokens(tokens, { "landing/public/styles.css": read("landing/public/styles.css") }, entries));
 const historical = execFileSync("git", ["show", "6d10041:landing/public/styles.css"], { encoding: "utf8" });
 assert.throws(() => checkBrowserTokens(tokens, { "6d10041:landing/public/styles.css": historical }, entries), /landing\/public\/ui.css/);
 assert.throws(() => checkBrowserTokens(tokens, {}, { page: "<html></html>" }), /load landing/);
});
test("browser handler check rejects the two original fragment implementations", () => {
 for (const revision of ["c515888", "998ed02"]) {
  const historical = execFileSync("git", ["show", `${revision}:src/auth/issuer.ts`], { encoding: "utf8" });
  assert.throws(() => checkBrowserPages({ [`${revision}:src/auth/issuer.ts`]: historical }), /src\/browser\/views.ts/);
 }
});

test("browser outcomes reject the two real plain-text success pages", () => {
 const issuer = read("src/auth/issuer.ts"), server = read("src/server.ts");
 assert.doesNotThrow(() => checkBrowserPages({ "src/auth/issuer.ts": issuer, "src/server.ts": server }));
 assert.doesNotThrow(() => checkBrowserOutcomes(issuer, server));
 for (const text of ["Identity linked after both reauthentications. Sign in again to resume your account.", "Exact command approved. Resubmit it from the originating session."]) {
  const historical = execFileSync("git", ["show", "875b305:src/auth/issuer.ts"], { encoding: "utf8" });
  assert.ok(historical.includes(text));
  assert.throws(() => checkBrowserOutcomes(issuer + "\nres.end(" + JSON.stringify(text) + ");", server), /completedPage or refusalPage/);
 }
 assert.throws(() => checkBrowserOutcomes(issuer, server.replace("sendPage(res, refusalPage())", "res.end()")), /browser error boundary/);
});


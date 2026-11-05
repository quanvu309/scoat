import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { checkHostRegistration } from "../scripts/check-structure.mjs";
const files = ["src/auth/registration.ts", "src/auth/issuer.ts"];
const source = files.map(file => readFileSync(file, "utf8"));
test("host registration rejects the real PR1 source and missing signed callback guarantees", () => {
  assert.doesNotThrow(() => checkHostRegistration(...source));
  const original = files.map(file => execFileSync("git", ["show", "a22c2c8:" + file], { encoding: "utf8" }));
  assert.throws(() => checkHostRegistration(...original), /Host registration/);
  for (const term of ['https://claude.ai/api/mcp/auth_callback', 'scoat-host-client-v2', 'scoat-chatgpt-client-v1', 'Number(loopback[2]) > 65535', 'timingSafeEqual']) {
    assert.throws(() => checkHostRegistration(source[0].replaceAll(term, "removed"), source[1]), /Host registration/);
  }
  assert.throws(() => checkHostRegistration(source[0], source[1].replace('bound && !bound.redirect_uris.includes(String(ctx.oidc.params?.redirect_uri))', 'false')), /Host registration/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { checkRefreshPolicy, checkAuthorizationPolicy } from "../scripts/check-structure.mjs";
const files = ["src/auth/issuer.ts","src/auth/registration.ts","src/auth/adapter.ts","src/server.ts","src/auth/link.ts","src/auth/erasure.ts"];
const sources = files.map(file => readFileSync(file,"utf8"));
test("refresh policy rejects the real pre-change source and missing guarantees", () => {
 assert.doesNotThrow(() => checkRefreshPolicy(...sources));
 const original = files.map(file => execFileSync("git",["show","875b305:" + file],{encoding:"utf8"}));
 assert.throws(() => checkRefreshPolicy(...original), /refresh/);
 for (const [index, before, after] of [[0,"rotateRefreshToken: true","rotateRefreshToken: false"],[0,"RefreshToken: 2592000","RefreshToken: 3600"],[0,"Grant: 2592000","Grant: 3600"],[0,"Session: 2592000","Session: 3600"],[0,"scoat:read scoat:write offline_access","scoat:read scoat:write"],[1,'grant_types: ["authorization_code", "refresh_token"]','grant_types: ["authorization_code"]'],[2,'["Grant", "Session", "RefreshToken"].includes(model) ? 2592000','owners.length ? 3600'],[3,'Bearer scope="scoat:read scoat:write offline_access"','Bearer'],[4,"await deleteAuthentication(client,","await ignored(client,"],[5,"DELETE FROM oauth_artifacts WHERE (model,id)","DELETE FROM unused WHERE (model,id)"]]) {
  assert.ok(sources[index].includes(before),before);
  const changed = [...sources]; changed[index] = changed[index].replace(before, after);
  assert.throws(() => checkRefreshPolicy(...changed), /refresh|Revoke/);
 }
 assert.throws(() => checkAuthorizationPolicy(original[0]), /shipped/);
});

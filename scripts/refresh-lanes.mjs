import assert from "node:assert/strict";
import { authFixture } from "./auth-fixture.mjs";
import { confirm } from "./memory-lanes.mjs";

export async function refreshLanes(databaseUrl) {
 const f = await authFixture(databaseUrl, { registration: true, entry: new URL("./auth-clock-server.mjs", import.meta.url) });
 const proofs = [];
 const login = (subject, client = "host-one") => f.login(client, subject, "offline_access scoat:read scoat:write");
 const refresh = async (token, client = "host-one") => {
  const response = await fetch(f.issuer + "/token", { method: "POST", body: new URLSearchParams({ grant_type: "refresh_token", client_id: client, refresh_token: token, resource: f.issuer + "/mcp" }) });
  return { status: response.status, body: await response.json() };
 };
 const refused = async (token, client) => {
  const result = await refresh(token, client);
  assert.equal(result.status, 400, JSON.stringify(result));
  assert.equal(result.body.error, "invalid_grant");
 };
 try {
  const challenge = await f.rpc(null, "tools/list");
  assert.match(challenge.challenge, /scope="scoat:read scoat:write"/);
  const discovery = await (await fetch(f.issuer + "/.well-known/oauth-authorization-server")).json();
  assert.ok(discovery.scopes_supported.includes("offline_access"));
  assert.ok(discovery.grant_types_supported.includes("refresh_token"));
  const one = await login("refresh-rotation");
  const lasting = await login("refresh-30-day");
  const linkTarget = await login("refresh-target");
  const linked = await login("refresh-link");
  const erased = await login("refresh-erase");
  const registered = await login("refresh-registered", "scoat-chatgpt");
  assert.ok(one.refreshToken);
  assert.equal(one.expiresIn, 900);
  assert.equal((await f.rpc(one.token, "tools/list")).status, 200);
  const lifetimes = await f.store.pool.query("SELECT model,extract(epoch FROM expires_at-now()) AS seconds FROM oauth_artifacts WHERE model IN ('RefreshToken','Session','Grant')");
  for (const row of lifetimes.rows) assert.ok(Number(row.seconds) > 2591900 && Number(row.seconds) <= 2592000, JSON.stringify(row));
  proofs.push("exchange-and-30-day-storage");
  await f.advanceClock(901);
  assert.equal((await f.rpc(one.token, "tools/list")).status, 401);
  const rotated = await refresh(one.refreshToken);
  assert.equal(rotated.status, 200, JSON.stringify(rotated));
  assert.notEqual(rotated.body.refresh_token, one.refreshToken);
  assert.equal((await f.rpc(rotated.body.access_token, "tools/list")).status, 200);
  await refused(one.refreshToken);
  await refused(rotated.body.refresh_token);
  const dynamic = await refresh(registered.refreshToken, "scoat-chatgpt");
  assert.equal(dynamic.status, 200, JSON.stringify(dynamic));
  proofs.push("expired-access-refresh-rotation-replay-family-revocation-static-and-registered");
  await f.restart();
  const linkResult = await f.link("refresh-target", "refresh-link");
  assert.equal(linkResult.status, 200, JSON.stringify(linkResult));
  await refused(linked.refreshToken);
  assert.equal((await refresh(linkTarget.refreshToken)).status, 200);
  proofs.push("link-revokes-retired-account-keeps-target");
  f.setIdentity("refresh-erase");
  const erase = await confirm(f, f.issuer + "/account/erase", "/account/erase", "erase");
  assert.equal(erase.result.status, 200, await erase.result.text());
  await refused(erased.refreshToken);
  proofs.push("browser-erasure-revokes-refresh");
  await f.advanceClock(2592001);
  await refused(lasting.refreshToken);
  proofs.push("30-day-token-expiry");
  return { status: "PASS", proofs, fixtureOnly: true, realHosts: "UNTESTED" };
 } finally { await f.close(); }
}

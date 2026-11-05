import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { authFixture } from "./auth-fixture.mjs";
const read = (result) => {
  assert.ok(!result.isError, JSON.stringify(result));
  return result._meta?.["scoat/readCapability"] ?? result.structuredContent;
};
export async function authLanes(databaseUrl) {
  const f = await authFixture(databaseUrl, { registration: true });
  const transcript = [];
  const intent = {
    product: { kind: "description", text: "SYNTHETIC P05 product" },
    variant: "synthetic",
    shop: null,
    budget: null,
  };
  const call = async (token, op, args = {}) =>
    read(await f.tool(token, "scoat_hunt", { op, ...args }));
  const passed = (lane, data) =>
    transcript.push({ lane, status: "PASS", fixtureOnly: true, ...data });
  try {
    assert.equal((await f.rpc(null, "tools/list")).status, 401);
    const one = await f.login("host-one", undefined, "offline_access scoat:read scoat:write");
    assert.equal(typeof one.refresh, "string", "code exchange must issue a refresh token");
    const delayed = await f.login("host-one", undefined, undefined, true);
    const flowState = createHash("sha256").update(delayed.body.get("state")).digest("hex");
    const delayedFlow = (await f.store.pool.query("SELECT data FROM oauth_browser_flows WHERE state=$1", [flowState])).rows[0].data;
    const aged = await f.store.pool.query("UPDATE oauth_artifacts SET expires_at=expires_at-interval '6 minutes',payload=jsonb_set(payload,'{exp}',to_jsonb((payload->>'exp')::bigint-360)) WHERE model='Interaction' AND id=$1 RETURNING id", [delayedFlow.context.uid]);
    assert.equal(aged.rowCount, 1);
    let delayedResponse = await f.browser(delayed.callback, { method: delayed.method, headers: { origin: f.issuer }, body: delayed.body });
    assert.equal(delayedResponse.status, 303, "A valid code after six minutes must preserve the OAuth continuation: " + await delayedResponse.clone().text());
    for (let step = 0; step < 5 && delayedResponse.status === 303; step++) delayedResponse = await f.browser(new URL(delayedResponse.headers.get("location"), f.issuer));
    assert.equal(delayedResponse.status, 200);
    assert.match(await delayedResponse.text(), /Allow/);
    assert.equal(delayed.interactionCookies.length, 2);
    for (const cookie of delayed.interactionCookies) {
      const expires = cookie.match(/expires=([^;]+)/i)?.[1];
      assert.ok(expires && Date.parse(expires) - Date.now() > 19 * 60 * 1000, "Interaction and resume cookies must outlive the email flow");
    }
    passed("late-code", { interactionAgedSeconds: 360, consentReached: true, interactionCookieLifetimeSeconds: 1200 });
    const refresh = async (login, value = login.refresh) => {
      const response = await fetch(f.issuer + "/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: login.client, grant_type: "refresh_token", refresh_token: value, resource: f.issuer + "/mcp" }) });
      return { status: response.status, body: await response.json() };
    };
    const renewable = await f.login("host-one", "refresh-only", "offline_access scoat:read scoat:write");
    const renewablePrincipal = await f.authenticate(renewable.token);
    const lifetimes = await f.store.pool.query("SELECT model,extract(epoch FROM expires_at-now()) AS seconds FROM oauth_artifacts WHERE model=ANY($1) AND id IN (SELECT id FROM oauth_artifact_owners WHERE account=$2)", [["Grant", "Session", "RefreshToken"], renewablePrincipal.agent.account]);
    for (const model of ["Grant", "Session", "RefreshToken"]) assert.ok(lifetimes.rows.some(row => row.model === model && Number(row.seconds) > 29 * 86400), model + " must outlive access tokens");
    await f.store.pool.query("UPDATE oauth_artifacts SET expires_at=now()-interval '1 second',payload=jsonb_set(payload,'{exp}',to_jsonb(floor(extract(epoch FROM now()))::bigint-1)) WHERE model='AccessToken' AND payload->>'accountId'=$1", [renewablePrincipal.agent.account]);
    assert.equal((await f.rpc(renewable.token, "tools/list")).status, 401);
    const refreshedTokens = await refresh(renewable);
    assert.equal(refreshedTokens.status, 200, JSON.stringify(refreshedTokens.body));
    assert.notEqual(refreshedTokens.body.refresh_token, renewable.refresh);
    assert.equal((await f.rpc(refreshedTokens.body.access_token, "tools/list")).status, 200);
    assert.equal((await refresh(renewable)).body.error, "invalid_grant");
    assert.equal((await refresh(renewable, refreshedTokens.body.refresh_token)).body.error, "invalid_grant");
    passed("refresh", { controlledAccessExpiry: true, rotation: true, reusedTokenAndGrantRefused: true, parentLifetimeDays: 30 });
    const discovery = await (await fetch(f.issuer + "/.well-known/oauth-authorization-server")).json();
    assert.equal(discovery.registration_endpoint, f.issuer + "/reg");
    assert.deepEqual(discovery.code_challenge_methods_supported, ["S256"]);
    assert.deepEqual(discovery.token_endpoint_auth_methods_supported, ["none"]);
    const registered = await fetch(discovery.registration_endpoint, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"] }),
    });
    assert.equal(registered.status, 201);
    assert.equal(registered.headers.get("cache-control"), "no-store");
    const registration = await registered.json();
    assert.equal(registration.client_id, "scoat-chatgpt");
    const two = await f.login(registration.client_id);
    const callback = "https://chatgpt.com/connector/oauth/p05_connection";
    const scopedResponse = await fetch(discovery.registration_endpoint, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ redirect_uris: [callback], grant_types: ["authorization_code", "refresh_token"], token_endpoint_auth_method: "none" }),
    });
    assert.equal(scopedResponse.status, 201);
    const scoped = await scopedResponse.json();
    assert.deepEqual(scoped.grant_types, ["authorization_code", "refresh_token"]);
    const scopedLogin = await f.login(scoped.client_id, undefined, undefined, false, callback);
    for (const wrong of ["https://chatgpt.com/connector/oauth/another_connection", "https://attacker.example/cb", "https://chatgpt.com/connector_platform_oauth_redirect"]) {
      const params = new URLSearchParams({ client_id: scoped.client_id, redirect_uri: wrong, response_type: "code", scope: "openid scoat:read scoat:write", state: "binding-negative", resource: f.issuer + "/mcp", code_challenge: createHash("sha256").update("verifier".repeat(8)).digest("base64url"), code_challenge_method: "S256" });
      const denied = await fetch(f.issuer + "/auth?" + params, { redirect: "manual" });
      assert.equal(denied.status, 400);
      assert.equal(denied.headers.get("location"), null);
    }

    for (const callback of ["https://claude.ai/api/mcp/auth_callback", "http://localhost:54321/callback", "http://127.0.0.1:54322/callback", "http://localhost/callback"]) {
      const response = await fetch(discovery.registration_endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: [callback] }) });
      assert.equal(response.status, 201);
      const registered = await response.json();
      const redirect = callback.startsWith("http:") ? callback.replace(/(?::[0-9]+)?\/callback$/, ":54323/callback") : callback;
      const login = await f.login(registered.client_id, undefined, "offline_access scoat:read scoat:write", false, redirect);
      assert.equal(typeof login.refresh, "string");
      assert.equal((await refresh(login)).status, 200);
      for (const wrong of [callback + "/extra", "https://attacker.example/callback", callback.replace("localhost", "127.0.0.1").replace("claude.ai", "chatgpt.com")].filter(value => value !== callback)) {
        const denied = await fetch(f.issuer + "/auth?" + new URLSearchParams({ client_id: registered.client_id, redirect_uri: wrong, response_type: "code", scope: "openid", state: "wrong-callback", resource: f.issuer + "/mcp", code_challenge: "A".repeat(43), code_challenge_method: "S256" }), { redirect: "manual" });
        assert.equal(denied.status, 400);
        assert.equal(denied.headers.get("location"), null);
      }
    }
    const foreignRegistration = await fetch(discovery.registration_endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: ["https://attacker.example/callback"] }) });
    assert.equal(foreignRegistration.status, 400);
    passed("claude", { hostedAndLoopbackCodeExchanges: 4, portIndependentLoopbackOnly: true, callbackSubstitutionRefused: true });
    assert.equal((await f.store.pool.query("SELECT count(*) FROM oauth_artifacts WHERE model='Client'")).rows[0].count, "0");
    const request = { requestKey: randomUUID(), intent, profile: null };
    const start = await call(one.token, "start", request);
    assert.ok(start.ok, JSON.stringify(start));
    let view = start.value.view;
    const list = await call(two.token, "list");
    assert.equal(list.value.hunts[0].hunt, view.hunt);
    assert.equal((await call(scopedLogin.token, "list")).value.hunts[0].hunt, view.hunt);
    const before = await f.store.pool.query(
      "SELECT count(*) FROM hunt_receipts",
    );
    passed(1, { unauthenticated: 401, authenticatedStart: true });
    passed(2, {
      clients: [one.client, two.client],
      sameHunt: true,
      automaticRegistration: { status: registered.status, client: registration.client_id, clientArtifacts: 0, callbackBoundCodeExchange: true, wrongCallbackRefusals: 3 },
      loginSteps: one.steps,
    });
    const foreign = await f.login(registration.client_id, "same-email-other-subject", "offline_access scoat:read scoat:write");
    assert.equal((await call(foreign.token, "list")).value.hunts.length, 0);
    passed(3, {
      distinctSubjectIsolated: true,
      sharedRegistrationClient: registration.client_id,
      emailFixture: "same@example.invalid",
      emailUnusedByProduction: true,
    });
    for (const change of ["expiry", "audience", "scope"]) {
      const test = await f.login();
      const model = (
        await f.store.pool.query(
          "SELECT id,payload FROM oauth_artifacts WHERE model='AccessToken' AND payload->>'accountId'=$1 ORDER BY expires_at DESC LIMIT 1",
          [
            view.account ??
              (
                await f.store.pool.query(
                  "SELECT account FROM oauth_identities WHERE subject=$1", [await f.subjectFor("upstream-subject-A")],
                )
              ).rows[0].account,
          ],
        )
      ).rows[0];
      assert.ok(model);
      const patch =
        change === "expiry"
          ? { exp: 1 }
          : change === "audience"
            ? { aud: "https://wrong.invalid/mcp" }
            : { scope: "other:scope" };
      await f.store.pool.query(
        "UPDATE oauth_artifacts SET payload=payload||$2::jsonb WHERE model='AccessToken' AND id=$1",
        [model.id, JSON.stringify(patch)],
      );
      assert.equal(
        (
          await f.rpc(test.token, "tools/call", {
            name: "scoat_hunt",
            arguments: {
              op: "start",
              requestKey: randomUUID(),
              intent,
              profile: null,
            },
          })
        ).status,
        401,
      );
    }
    const revoked = await f.login();
    assert.equal(
      (
        await fetch(f.issuer + "/token/revocation", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: "host-one",
            token: revoked.token,
          }),
        })
      ).status,
      200,
    );
    assert.equal((await f.rpc(revoked.token, "tools/list")).status, 401);
    assert.equal(
      (await f.store.pool.query("SELECT count(*) FROM hunt_receipts")).rows[0]
        .count,
      before.rows[0].count,
    );
    passed(4, {
      expired: 401,
      revoked: 401,
      wrongResource: 401,
      wrongScope: 401,
      unauthorizedMutations: 0,
    });
    const params = {
      client_id: "host-one",
      redirect_uri: "https://client.example/cb",
      response_type: "code",
      scope: "openid scoat:read",
      resource: f.issuer + "/mcp",
      state: "state",
      code_challenge: "A".repeat(43),
      code_challenge_method: "S256",
    };
    for (const field of ["state", "code_challenge", "code_challenge_method"]) {
      const raw = { ...params };
      delete raw[field];
      const response = await fetch(
        f.issuer + "/auth?" + new URLSearchParams(raw),
        { redirect: "manual" },
      );
      if (field === "code_challenge") {
        assert.match(
          response.headers.get("location") ?? (await response.text()),
          /error|invalid/,
        );
      } else {
        assert.ok(response.status === 400 || /error=/.test(response.headers.get("location") ?? ""));
      }
    }
    for (const path of ["/auth", "/auth/", "/AUTH", "/Auth"]) {
      for (const field of ["state", "resource", "code_challenge_method"]) {
        const raw = { ...params };
        delete raw[field];
        const refused = await fetch(f.issuer + path + "?" + new URLSearchParams(raw), { redirect: "manual" });
        assert.ok(refused.status === 400 || /error=/.test(refused.headers.get("location") ?? ""), path + ":" + field);
        assert.ok(!/interaction/.test(refused.headers.get("location") ?? ""));
      }
    }
    const wrongResource = await fetch(f.issuer + "/auth?" + new URLSearchParams({ ...params, resource: "https://wrong.invalid/mcp" }), { redirect: "manual" });
    assert.notEqual(wrongResource.status, 500);
    assert.match(wrongResource.headers.get("location") ?? await wrongResource.text(), /invalid_target/);
    const metadata = await (await fetch(f.issuer + "/.well-known/openid-configuration")).json();
    assert.deepEqual(metadata.response_types_supported, ["code"]);
    assert.ok(metadata.scopes_supported.includes("offline_access"));
    assert.deepEqual(metadata.grant_types_supported, ["authorization_code", "refresh_token"]);
    for (const key of ["userinfo_endpoint", "end_session_endpoint", "pushed_authorization_request_endpoint", "dpop_signing_alg_values_supported"]) assert.equal(metadata[key], undefined);
    const substituted = await fetch(
      f.issuer +
        "/auth?" +
        new URLSearchParams({
          ...params,
          redirect_uri: "https://attacker.invalid/cb",
        }),
      { redirect: "manual" },
    );
    assert.equal(substituted.status, 400);
    assert.equal(substituted.headers.get("location"), null);
    passed(5, {
      missingStateRejected: true,
      missingPkceRejected: true,
      redirectSubstitution: 400,
    });
    const active = await f.login();
    const account = (
      await f.store.pool.query(
        "SELECT account FROM oauth_identities WHERE subject=$1", [await f.subjectFor("upstream-subject-A")],
      )
    ).rows[0].account;
    const grants = read(
      await f.tool(active.token, "scoat_card", { op: "open", hunt: view.hunt }),
    );
    assert.ok(grants.grant);
    const bad = await f.tool(foreign.token, "scoat_card", {
      op: "read",
      hunt: view.hunt,
      grant: grants.grant,
    });
    assert.ok(bad.isError);
    const otherView = (
      await call(active.token, "start", {
        requestKey: randomUUID(),
        intent,
        profile: null,
      })
    ).value.view;
    const wrongHunt = await f.tool(active.token, "scoat_card", {
      op: "read",
      hunt: otherView.hunt,
      grant: grants.grant,
    });
    assert.ok(wrongHunt.isError);
    const sessionOther = await f.login("host-two");
    assert.ok(
      (
        await f.tool(sessionOther.token, "scoat_card", {
          op: "read",
          hunt: view.hunt,
          grant: grants.grant,
        })
      ).isError,
    );
    assert.ok(
      (
        await f.tool(active.token, "scoat_card", {
          op: "act",
          hunt: view.hunt,
          grant: grants.grant,
          requestKey: randomUUID(),
          action: { kind: "stop" },
          person: account,
        })
      ).isError,
    );
    passed(6, {
      wrongAccountDenied: true,
      wrongHuntDenied: true,
      wrongSessionDenied: true,
      personForgeryDenied: true,
    });
    await f.store.pool.query(
      "UPDATE oauth_read_grants SET expires_at=now()-interval '1 second' WHERE digest=$1",
      [createHash("sha256").update(grants.grant).digest("hex")],
    );
    assert.ok(
      (
        await f.tool(active.token, "scoat_card", {
          op: "read",
          hunt: view.hunt,
          grant: grants.grant,
        })
      ).isError,
    );
    const renewed = read(
      await f.tool(active.token, "scoat_card", {
        op: "renew",
        hunt: view.hunt,
        grant: grants.grant,
      }),
    );
    assert.notEqual(renewed.grant, grants.grant);
    assert.ok(
      read(
        await f.tool(active.token, "scoat_card", {
          op: "read",
          hunt: view.hunt,
          grant: renewed.grant,
        }),
      ).ok,
    );
    read(
      await f.tool(active.token, "scoat_card", {
        op: "revoke",
        hunt: view.hunt,
        grant: renewed.grant,
      }),
    );
    assert.ok(
      (
        await f.tool(active.token, "scoat_card", {
          op: "read",
          hunt: view.hunt,
          grant: renewed.grant,
        })
      ).isError,
    );
    const opened = await f.tool(active.token, "scoat_card", {op:"open",hunt:view.hunt});
    const contested = read(opened);
    assert.deepEqual(opened.structuredContent,{ok:true,value:{capability:"issued",expiresAt:contested.expiresAt}});
    assert(!JSON.stringify(opened.structuredContent).includes(contested.grant));
    assert(!JSON.stringify(opened.content).includes(contested.grant));
    const renewals = await Promise.all(
      [1, 2].map(() =>
        f.tool(active.token, "scoat_card", {
          op: "renew",
          hunt: view.hunt,
          grant: contested.grant,
        }),
      ),
    );
    assert.equal(renewals.filter((result) => result.isError).length, 1);
    assert.equal(
      renewals.filter((result) => result._meta?.["scoat/readCapability"]?.grant).length,
      1,
    );
    passed(7, {
      expiredReadDenied: true,
      capabilityPrivateMetadataOnly: true,
      renewedSameBinding: true,
      revokedReadDenied: true,
      concurrentRenewalSingleWinner: true,
    });
    await f.restart();
    const replay = await call(active.token, "start", request);
    assert.deepEqual(replay, start);
    passed(8, { productionProcessRestarted: true, durableExactReplay: true });
    const prompt = await f.rpc(active.token, "prompts/get", {
      name: "hunt-best-benefit",
      arguments: {},
    });
    assert.ok(prompt.body.result.messages[0].content.text.includes("GBP"));
    const resources = await f.rpc(active.token, "resources/list");
    const pinned = resources.body.result.resources.find((r) =>
      r.uri.startsWith("scoat://"),
    );
    assert.ok(pinned);
    const resource = await f.rpc(active.token, "resources/read", {
      uri: pinned.uri,
    });
    assert.ok(resource.body.result.contents[0].text.length > 500);
    passed(9, { promptRead: true, pinnedResourceRead: true });
    assert.equal(
      (await f.rpc(active.token, "tools/list")).body.result.tools.length,
      4,
    );
    for (const fields of [
      { account: "forged" },
      { person: "forged" },
      { total: 1 },
    ])
      assert.ok(
        (await f.tool(active.token, "scoat_hunt", { op: "list", ...fields }))
          .isError,
      );
    assert.ok(
      (await f.tool(active.token, "scoat_hunt", { op: "list", limit: 21 }))
        .isError,
    );
    const page = await call(active.token, "list", { limit: 1 });
    assert.equal(page.value.hunts.length, 1);
    assert.ok(page.value.next);
    const next = await call(active.token, "list", {
      limit: 1,
      after: page.value.next,
    });
    assert.equal(next.value.hunts.length, 1);
    assert.notEqual(next.value.hunts[0].hunt, page.value.hunts[0].hunt);
    for (const row of view.rows)
      for (const slot of row.slots) {
        const current = (await call(active.token, "read", { hunt: view.hunt }))
          .value.view;
        const record = await call(active.token, "record", {
          hunt: view.hunt,
          row: row.row.id,
          slot: slot.slot,
          expected: current.rows.find((r) => r.row.id === row.row.id).revision,
          requestKey: randomUUID(),
          outcome: {
            kind: "gap",
            reason: "SYNTHETIC named unavailable source",
          },
        });
        assert.ok(record.ok, JSON.stringify(record));
      }
    const finish = await call(active.token, "finish", {
      hunt: view.hunt,
      requestKey: randomUUID(),
      selection: null,
    });
    assert.ok(finish.ok, JSON.stringify(finish));
    passed(10, {
      fourTools: true,
      identityForgeryDenied: true,
      paginationBounded: true,
      recordAndFinish: true,
    });
    const wrongReauth = await f.link(
      "same-email-other-subject",
      "upstream-subject-A",
    );
    assert.equal(wrongReauth.status, 400, JSON.stringify(wrongReauth));
    for (const kind of ["hunts", "identities"]) {
      const subject = "refusal-" + kind;
      const candidate = await f.login("host-two", subject);
      if (kind === "hunts") assert.ok((await call(candidate.token, "start", { requestKey: randomUUID(), intent, profile: null })).ok);
      const binding = (await f.store.pool.query("SELECT issuer,subject,account,incarnation FROM oauth_identities WHERE subject=$1", [await f.subjectFor(subject)])).rows[0];
      if (kind === "identities") await f.store.pool.query("INSERT INTO oauth_identities(issuer,subject,account,incarnation) VALUES($1,$2,$3,$4)", [binding.issuer, subject + "-other", binding.account, binding.incarnation]);
      const snapshot = async () => ({
        accounts: (await f.store.pool.query("SELECT account,incarnation,erased FROM hunt_accounts WHERE account=$1", [binding.account])).rows,
        identities: (await f.store.pool.query("SELECT issuer,subject,account,incarnation FROM oauth_identities WHERE account=$1 ORDER BY issuer,subject", [binding.account])).rows,
        hunts: (await f.store.pool.query("SELECT * FROM durable_hunts WHERE account=$1 ORDER BY id", [binding.account])).rows,
      });
      const before = await snapshot();
      const denied = await f.link("upstream-subject-A", subject);
      assert.equal(denied.status, 400, JSON.stringify(denied));
      assert.deepEqual(await snapshot(), before);
      assert.equal((await f.rpc(candidate.token, "tools/list")).status, 200);
    }
    const movedPrincipal = await f.authenticate(foreign.token);
    const linked = await f.link(
      "upstream-subject-A",
      "same-email-other-subject",
    );
    assert.equal(linked.status, 200, JSON.stringify(linked));
    assert.equal((await refresh(foreign)).body.error, "invalid_grant");
    assert.equal((await f.rpc(foreign.token, "tools/list")).status, 401);
    await assert.rejects(() => f.store.transact({ ...movedPrincipal.agent, hunt: null, row: null, request: null }, async () => true), /Inactive account incarnation/);
    const { authenticatedDispatch } = await import("../dist/mcp/authenticated.js");
    const { parseToolCall } = await import("../dist/mcp/index.js");
    const staleStart = await authenticatedDispatch(f.store, movedPrincipal)(parseToolCall("scoat_hunt", { op: "start", requestKey: randomUUID(), intent, profile: null }));
    assert.equal(staleStart.structuredContent.ok, false);
    assert.equal(staleStart.structuredContent.error.code, "forbidden");
    const retired = await f.store.pool.query("SELECT erased FROM hunt_accounts WHERE account=$1 AND incarnation=$2", [movedPrincipal.agent.account, movedPrincipal.agent.incarnation]);
    assert.equal(retired.rows[0].erased, true);
    const linkedLogin = await f.login("host-two", "same-email-other-subject");
    assert.equal((await call(linkedLogin.token, "list")).value.hunts.length, 2);
    assert.equal((await f.rpc(foreign.token, "tools/list")).status, 401);
    const body = await fetch(f.issuer + "/mcp", {
      method: "POST",
      headers: {
        authorization: "Bearer " + active.token,
        "content-type": "application/json",
      },
      body: "x".repeat(65537),
    });
    assert.equal(body.status, 413);
    assert.equal(
      (await fetch(f.issuer + "/login/complete", { method:"POST", headers:{origin:f.issuer}, body:new URLSearchParams({state:"forged",code:"000000"}), redirect: "manual" }))
        .status,
      400,
    );
    const { ReadGrants } = await import("../dist/auth/grants.js");
    await f.store.pool.query("ALTER TABLE oauth_artifacts RENAME TO unavailable_oauth_artifacts");
    try {
      const unavailable = await f.rpc(active.token, "tools/list");
      assert.equal(unavailable.status, 503);
      assert.equal(unavailable.challenge, null);
    } finally {
      await f.store.pool.query("ALTER TABLE unavailable_oauth_artifacts RENAME TO oauth_artifacts");
    }
    const eraseRefresh = await f.login("host-one", undefined, "offline_access scoat:read scoat:write");
    const priorPrincipal = await f.authenticate(active.token);
    const capabilities = new ReadGrants(f.store.pool);
    const priorGrant = await capabilities.open(priorPrincipal, view.hunt);
    await f.store.pool.query(
      "UPDATE hunt_accounts SET erased=true WHERE account=$1",
      [account],
    );
    assert.equal((await refresh(eraseRefresh)).body.error, "invalid_grant");
    assert.equal((await f.rpc(active.token, "tools/list")).status, 401);
    assert.equal((await f.rpc(linkedLogin.token, "tools/list")).status, 401);
    await assert.rejects(
      capabilities.open(priorPrincipal, view.hunt),
      /revoked/,
    );
    for (const op of ["read", "renew", "revoke"])
      await assert.rejects(
        capabilities.use(priorPrincipal, view.hunt, priorGrant.grant, op),
        /revoked/,
      );
    const version = (await f.store.pool.query("SHOW server_version")).rows[0]
      .server_version;
    return {
      transcript,
      interactions: f.interactions,
      projection: finish.value.view,
      postgres: version,
      externalHostLanes: Array.from({ length: 10 }, (_, i) => ({
        lane: i + 1,
        status: "UNTESTED",
        reason:
          "No real gpt-6-luna host/browser evidence; local HTTPS issuer harness only",
      })),
      linking: {
        status: "PASS",
        reauthMismatch: 400,
        candidateHuntsRejectedWithoutMutation: true,
        candidateIdentitiesRejectedWithoutMutation: true,
        twoReauthentications: true,
        oldTokensRevoked: true,
        browserEntry: "GET /account/link",
        forgedAndReplayedConfirmation: 400,
        retiredAccountRejectsPreviouslyVerifiedPrincipal: true,
      },
      incarnationGrantLane: {
        status: "PASS",
        tombstoneDeniesOuterAccount: true,
      },
      authorizationPolicy: { status: "PASS", aliases: ["/auth", "/auth/", "/AUTH", "/Auth"], required: ["state", "resource", "code_challenge_method"], wrongResource: "invalid_target", codeFlowDiscoveryOnly: true, dpopDisabled: true },
      infrastructureOutage: { status: "PASS", http: 503, credentialChallenge: false },
      bodyBoundsLane: { status: "PASS", oversize: 413 },
    };
  } finally {
    await f.close();
  }
}

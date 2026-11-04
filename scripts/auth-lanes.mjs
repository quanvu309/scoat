import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { authFixture } from "./auth-fixture.mjs";
const read = (result) => {
  assert.ok(!result.isError, JSON.stringify(result));
  return result.structuredContent;
};
export async function authLanes(databaseUrl) {
  const f = await authFixture(databaseUrl);
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
    const one = await f.login();
    const two = await f.login("host-two");
    const request = { requestKey: randomUUID(), intent, profile: null };
    const start = await call(one.token, "start", request);
    assert.ok(start.ok, JSON.stringify(start));
    let view = start.value.view;
    const list = await call(two.token, "list");
    assert.equal(list.value.hunts[0].hunt, view.hunt);
    const before = await f.store.pool.query(
      "SELECT count(*) FROM hunt_receipts",
    );
    passed(1, { unauthenticated: 401, authenticatedStart: true });
    passed(2, {
      clients: [one.client, two.client],
      sameHunt: true,
      loginSteps: one.steps,
    });
    const foreign = await f.login("host-one", "same-email-other-subject");
    assert.equal((await call(foreign.token, "list")).value.hunts.length, 0);
    passed(3, {
      distinctSubjectIsolated: true,
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
                  "SELECT account FROM oauth_identities WHERE subject='upstream-subject-A'",
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
      } else assert.equal(response.status, 400);
    }
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
        "SELECT account FROM oauth_identities WHERE subject='upstream-subject-A'",
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
    const contested = read(
      await f.tool(active.token, "scoat_card", {
        op: "open",
        hunt: view.hunt,
      }),
    );
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
      renewals.filter((result) => result.structuredContent?.grant).length,
      1,
    );
    passed(7, {
      expiredReadDenied: true,
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
      active.token,
      "same-email-other-subject",
      "upstream-subject-A",
    );
    assert.equal(wrongReauth.status, 400, JSON.stringify(wrongReauth));
    const linked = await f.link(
      active.token,
      "upstream-subject-A",
      "same-email-other-subject",
    );
    assert.equal(linked.status, 200, JSON.stringify(linked));
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
      (await fetch(f.issuer + "/upstream/callback", { redirect: "manual" }))
        .status,
      400,
    );
    const { principalFor } = await import("../dist/auth/identity.js");
    const { ReadGrants } = await import("../dist/auth/grants.js");
    const session = (
      await f.store.pool.query(
        "SELECT payload FROM oauth_artifacts WHERE model='Session' AND payload->>'accountId'=$1 LIMIT 1",
        [account],
      )
    ).rows[0].payload;
    const priorPrincipal = await principalFor(
      f.store.pool,
      account,
      "host-one",
      session.uid,
      "scoat:read",
    );
    const capabilities = new ReadGrants(f.store.pool);
    const priorGrant = await capabilities.open(priorPrincipal, view.hunt);
    await f.store.pool.query(
      "UPDATE hunt_accounts SET erased=true WHERE account=$1",
      [account],
    );
    assert.equal((await f.rpc(active.token, "tools/list")).status, 401);
    assert.equal((await f.rpc(linkedLogin.token, "tools/list")).status, 401);
    await assert.rejects(
      capabilities.open(priorPrincipal, view.hunt),
      /Inactive account incarnation/,
    );
    for (const op of ["read", "renew", "revoke"])
      await assert.rejects(
        capabilities.use(priorPrincipal, view.hunt, priorGrant.grant, op),
        /Inactive account incarnation/,
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
        twoReauthentications: true,
        oldTokensRevoked: true,
      },
      incarnationGrantLane: {
        status: "PASS",
        tombstoneDeniesOuterAccount: true,
      },
      bodyBoundsLane: { status: "PASS", oversize: 413 },
    };
  } finally {
    await f.close();
  }
}

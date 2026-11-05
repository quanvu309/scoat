import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { withDatabase } from "./durable-database.mjs";
import { authFixture } from "./auth-fixture.mjs";
import { evidence } from "./auth-evidence.mjs";
const report = await evidence("perf");
const batches = [];
let postgres;
let issuerLoginMs;
await withDatabase(async (databaseUrl) => {
  const f = await authFixture(databaseUrl);
  try {
    const begin = performance.now();
    const login = await f.login();
    issuerLoginMs = performance.now() - begin;
    const intent = {
      product: { kind: "description", text: "SYNTHETIC P05 performance" },
      variant: "synthetic",
      shop: null,
      budget: null,
    };
    const views = [];
    for (let n = 0; n < 100; n++) {
      const result = await f.tool(login.token, "scoat_hunt", {
        op: "start",
        requestKey: randomUUID(),
        intent,
        profile: null,
      });
      assert.ok(result.structuredContent.ok);
      views.push(result.structuredContent.value.view);
    }
    async function sample(batch) {
      const samples = [];
      await Promise.all(
        Array.from({ length: 8 }, async (_, client) => {
          for (let index = client; index < 100; index += 8) {
            const view = views[index];
            const args =
              index % 2 === 0
                ? { op: "read", hunt: view.hunt }
                : {
                    op: "record",
                    hunt: view.hunt,
                    row: view.rows[0].row.id,
                    slot: view.rows[0].slots[0].slot,
                    expected: batch,
                    requestKey: randomUUID(),
                    outcome: {
                      kind: "gap",
                      reason: "SYNTHETIC unavailable source",
                    },
                  };
            const start = performance.now();
            const reply = await f.rpc(login.token, "tools/call", {
              name: "scoat_hunt",
              arguments: args,
            });
            const ms = performance.now() - start;
            assert.equal(reply.status, 200);
            assert.ok(
              reply.body.result?.structuredContent?.ok,
              JSON.stringify(reply.body),
            );
            const timing = Object.fromEntries(
              [
                ...reply.timing.matchAll(/(validation|handler);dur=([\d.]+)/g),
              ].map(([, key, value]) => [key, Number(value)]),
            );
            assert.ok(
              Number.isFinite(timing.validation) &&
                Number.isFinite(timing.handler),
            );
            samples.push({
              client,
              index,
              op: args.op,
              ms,
              validationMs: timing.validation,
              handlerMs: timing.handler,
            });
          }
        }),
      );
      assert.equal(samples.length, 100);
      return samples;
    }
    await sample(0);
    for (let batch = 1; batch <= 5; batch++) {
      const samples = await sample(batch);
      const p95Ms = [...samples.map((s) => s.ms)].sort((a, b) => a - b)[94];
      batches.push({ batch, p95Ms, samples });
    }
    const before = (
      await f.store.pool.query("SELECT count(*) FROM hunt_receipts")
    ).rows[0].count;
    assert.equal(
      (
        await f.rpc("forged", "tools/call", {
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
    assert.equal(
      (await f.store.pool.query("SELECT count(*) FROM hunt_receipts")).rows[0]
        .count,
      before,
    );
    postgres = (await f.store.pool.query("SHOW server_version")).rows[0]
      .server_version;
  } finally {
    await f.close();
  }
});
const all = batches.flatMap((b) => b.samples);
const p95Ms = [...all.map((s) => s.ms)].sort((a, b) => a - b)[
  Math.ceil(all.length * 0.95) - 1
];
const result = {
  ...report.identity,
  baseline: report.baseline,
  postgres,
  status:
    p95Ms <= 750 && batches.every((b) => b.p95Ms <= 750)
      ? "PASS_LOCAL_ONLY"
      : "FAIL",
  p95Ms,
  batches,
  fixture: {
    hunts: 100,
    clients: 8,
    samples: 500,
    batches: 5,
    operations: ["read", "record"],
    issuer: "local separate HTTPS upstream process and persistent Scoat issuer",
    database: "disposable isolated schema",
  },
  issuerNetwork: {
    warmCallsMs: 0,
    loginRoundTripMs: issuerLoginMs,
    loginIncludes:
      "browser simulation, upstream issuer, Scoat validation and consent; separate from warm call distribution",
  },
  exclusions: [
    "install",
    "startup",
    "100 fixture starts",
    "one 100-call warm batch",
    "OAuth login",
    "external provider and real host network",
  ],
  validation:
    "Server-Timing includes local token/session/grant PostgreSQL verification",
  handler:
    "Server-Timing includes registry dispatch and durable transaction; total also includes transport/serialization",
  unauthorizedMutations: 0,
  fixedTwoVcpu: "UNTESTED",
  externalHosts: "UNTESTED",
  regressionRatio: null,
};
await report.save("receipt.json", result);
console.log(
  JSON.stringify({
    status: result.status,
    p95Ms,
    batchP95Ms: batches.map((b) => b.p95Ms),
    evidence: report.root,
  }),
);
if (result.status === "FAIL") process.exitCode = 1;

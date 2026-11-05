import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { parse, stringify } from "yaml";
import { checkWorkflow } from "../scripts/check-structure.mjs";
import { checkHostedCoverage } from "../scripts/check-operations.mjs";

const source = readFileSync(new URL("../.github/workflows/ci.yaml", import.meta.url), "utf8");
const workflow = () => parse(source);
const suites = ["quality", "protocol", "browser", "operations", "watch-performance"];
function rejects(change, diagnostic) {
 const value = workflow();
 change(value);
 const mutated = stringify(value);
 assert.notDeepEqual(value, workflow());
 assert.throws(() => checkWorkflow(mutated), diagnostic);
 assert.throws(() => checkHostedCoverage(mutated), diagnostic);
}

test("every literal hosted command and repetition is required in its suite", () => {
 assert.doesNotThrow(() => checkWorkflow(source));
 rejects(w => { const steps = w.jobs.protocol.steps; [steps[4], steps[6]] = [steps[6], steps[4]]; }, /retain suite order/);
 for (const id of suites) {
  const steps = workflow().jobs[id].steps;
  for (let index = 4; index < steps.length; index++) {
   if (!/^npm /.test(steps[index].run ?? "")) continue;
   const command = steps[index].run;
   rejects(w => w.jobs[id].steps.splice(index, 1), new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
 }
});

test("baseline source, pinned Node, install, build and fixture settings belong to every consumer", () => {
 for (const id of suites) {
  for (const [index, diagnostic] of [[0, /fetch-depth: 0/], [1, /pinned Node|executable/], [2, /npm ci and build/], [3, /npm ci and build/]]) {
   rejects(w => w.jobs[id].steps.splice(index, 1), diagnostic);
   rejects(w => w.jobs.foundation.steps.push(w.jobs[id].steps.splice(index, 1)[0]), diagnostic);
   rejects(w => w.jobs[id].steps.push(w.jobs[id].steps.splice(index, 1)[0]), diagnostic);
  }
  rejects(w => { w.jobs[id].steps[0].with["fetch-depth"] = 1; }, /fetch-depth: 0/);
  rejects(w => { w.jobs[id].steps[1].with["node-version"] = "24"; }, /pinned Node/);
  rejects(w => { delete w.jobs[id].services; }, /isolated PostgreSQL/);
  rejects(w => { delete w.jobs[id].env.DATABASE_URL; }, /fixture DATABASE_URL/);
  rejects(w => { w.jobs[id].services.postgres.env.POSTGRES_DB = "other"; }, /isolated PostgreSQL/);
  rejects(w => { w.jobs[id].env.DATABASE_URL = "postgres://other"; }, /fixture DATABASE_URL/);
 }
});

test("tools precede their consumers on the same runner", () => {
 for (const [id, pattern, diagnostic] of [["browser", /playwright install/, /Chromium/], ["protocol", /playwright install/, /Chromium/], ["operations", /playwright install/, /Chromium/], ["operations", /apt.postgresql.org/, /PGDG/], ["operations", /sudo ln/, /\/usr\/bin\/node executable/], ["operations", /install.*ffmpeg/, /ffmpeg/]]) {
  const index = workflow().jobs[id].steps.findIndex(step => pattern.test(step.run ?? ""));
  assert.ok(index >= 0);
  rejects(w => w.jobs[id].steps.splice(index, 1), diagnostic);
  rejects(w => w.jobs.quality.steps.push(w.jobs[id].steps.splice(index, 1)[0]), diagnostic);
  rejects(w => w.jobs[id].steps.push(w.jobs[id].steps.splice(index, 1)[0]), diagnostic);
 }
 rejects(w => { delete w.jobs.operations.env.SCOAT_PG_BIN; w.jobs.quality.env.SCOAT_PG_BIN = "/usr/lib/postgresql/18/bin"; }, /SCOAT_PG_BIN/);
});

test("required jobs and steps cannot skip, override fixtures or hide failure", () => {
 for (const id of suites) {
  for (const key of ["if", "continue-on-error"]) {
   rejects(w => { w.jobs[id][key] = true; }, /unconditional/);
   rejects(w => { w.jobs[id].steps[2][key] = true; }, /literal steps/);
  }
  rejects(w => { w.jobs[id].steps[4].env = { DATABASE_URL: "postgres://foreign" }; }, /literal steps/);
  rejects(w => { w.jobs[id].steps[0].with.ref = "foreign"; }, /full source/);
  rejects(w => { w.jobs[id].defaults = { run: { shell: "bash {0}" } }; }, /unconditional/);
  for (const suffix of [" || true", " &", "\ntrue", "; exit 0"]) rejects(w => { w.jobs[id].steps[2].run += suffix; }, /npm ci and build/);
 }
 for (const timeout of [0, -1, 61, 1.5, "60"]) rejects(w => { w.jobs.quality["timeout-minutes"] = timeout; }, /timeout-minutes/);
 rejects(w => { w.env = { DATABASE_URL: "foreign" }; }, /supported workflow/);
});

test("events and concurrency match PR and merged-main source", () => {
 for (const change of [w => { w.on.push.branches = ["*"]; }, w => { w.on.push.paths = ["src/**"]; }, w => { w.on.pull_request = { types: ["ready_for_review"] }; }, w => { w.on.workflow_dispatch = null; }]) rejects(change, /ordinary pull_request/);
 rejects(w => { w.concurrency.group = "shared"; }, /Scope cancellation/);
 rejects(w => { w.concurrency["cancel-in-progress"] = false; }, /Scope cancellation/);
});

test("foundation wiring and executable predicate fail closed", () => {
 for (const change of [w => w.jobs.foundation.needs.pop(), w => w.jobs.foundation.needs.push("extra"), w => { w.jobs.foundation.needs[0] = "protocol"; }, w => { delete w.jobs.foundation.if; }, w => { w.jobs.foundation["continue-on-error"] = true; }]) rejects(change, /foundation requires/);
 for (const change of [w => { w.jobs.foundation.steps[1].if = true; }, w => { w.jobs.foundation.steps[1].run = "true"; }, w => { w.jobs.foundation.steps[0].with["node-version"] = "24"; }, w => { w.jobs.foundation.steps[1].env.NEEDS_JSON = "{}"; }]) rejects(change, /fail-closed needs predicate/);
 const command = workflow().jobs.foundation.steps[1].run.trim();
 const success = Object.fromEntries(suites.map(id => [id, { result: "success" }]));
 const execute = input => spawnSync("bash", ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", command], { env: { PATH: process.env.PATH, ...(input === undefined ? {} : { NEEDS_JSON: input }) }, encoding: "utf8" }).status;
 assert.equal(execute(JSON.stringify(success)), 0);
 for (const value of [undefined, "", "{", "null", "[]", '"success"', "1", "true", "{}", JSON.stringify([{ result: "success" }]), JSON.stringify({ quality: { result: "success" } }), JSON.stringify({ ...success, extra: { result: "success" } })]) assert.notEqual(execute(value), 0);
 for (const id of suites) { const partial = { ...success }; delete partial[id]; assert.notEqual(execute(JSON.stringify(partial)), 0); }
 for (const id of suites) for (const result of ["failure", "skipped", "cancelled", "pending", null, "SUCCESS"]) assert.notEqual(execute(JSON.stringify({ ...success, [id]: { result } })), 0);
 for (const id of suites) for (const value of [null, {}, "success"]) assert.notEqual(execute(JSON.stringify({ ...success, [id]: value })), 0);
});

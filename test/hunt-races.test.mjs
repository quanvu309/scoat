import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
test("compiled PostgreSQL lifecycle, receipt and erasure races", { timeout:45000 }, async()=>{
 const {stdout}=await exec(process.execPath,["scripts/verify-durable.mjs"],{timeout:40000,maxBuffer:1000000});
 const report=JSON.parse(stdout.trim().split("\n").at(-1));
 assert(report.lanes.length>=10);
 assert(report.lanes.every(lane=>lane.status==="PASS"));
});

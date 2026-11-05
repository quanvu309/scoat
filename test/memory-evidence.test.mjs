import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import { rm } from "node:fs/promises";
import { scratchDirectory } from "../scripts/scratch.mjs";
import { memoryEvidence } from "../scripts/memory-evidence.mjs";
test("Memory transcripts preserve runner RAM metadata", async () => {
 const root=await scratchDirectory("memory-evidence-");
 const previous=process.env.SCOAT_EVIDENCE_DIR;
 process.env.SCOAT_EVIDENCE_DIR=root;
 try {
  const report=await memoryEvidence("test");
  const memory={transcript:[]};
  const original={memory:os.totalmem(),...{memory}};
  assert.equal(typeof original.memory,"object");
  const receipt={...report.identity,memory};
  assert.equal(receipt.memoryBytes,os.totalmem());
  assert.deepEqual(receipt.memory,memory);
 } finally {
  if (previous===undefined) delete process.env.SCOAT_EVIDENCE_DIR;
  else process.env.SCOAT_EVIDENCE_DIR=previous;
  await rm(root,{recursive:true,force:true});
 }
});

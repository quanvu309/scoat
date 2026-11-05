import test from "node:test";
import assert from "node:assert/strict";
import { rm, stat } from "node:fs/promises";
import path from "node:path";
import { scratchDirectory } from "../scripts/scratch.mjs";

test("scratch allocation creates an absent parent and isolates concurrent callers", async () => {
  const parent = await scratchDirectory("scoat-scratch-test-");
  try {
    const root = path.join(parent, "absent", "nested");
    const directories = await Promise.all([scratchDirectory("fixture-", root), scratchDirectory("fixture-", root)]);
    assert.equal(new Set(directories).size, 2);
    for (const directory of directories) {
      assert.equal(path.dirname(directory), root);
      assert.equal((await stat(directory)).isDirectory(), true);
    }
  } finally { await rm(parent, { recursive: true, force: true }); }
});

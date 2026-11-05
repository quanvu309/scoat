import test from "node:test";
import assert from "node:assert/strict";
import { withDatabase } from "../scripts/durable-database.mjs";
import { authLanes } from "../scripts/auth-lanes.mjs";
test("compiled HTTPS OAuth MCP durable behavior and negative boundary lanes", async () => {
  await withDatabase(async (databaseUrl: string) => {
    const result = await authLanes(databaseUrl);
    assert.equal(result.transcript.length, 10);
  });
});

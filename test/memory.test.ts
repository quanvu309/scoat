import test from "node:test";
import { withDatabase } from "../scripts/durable-database.mjs";
import { memoryLanes } from "../scripts/memory-lanes.mjs";
test("compiled Memory requires exact browser approval and preserves durable snapshots", async () => {
 await withDatabase(memoryLanes);
});

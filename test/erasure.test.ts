import test from "node:test";
import { withDatabase } from "../scripts/durable-database.mjs";
import { erasureLanes } from "../scripts/erasure-lanes.mjs";
test("compiled erasure removes all private owners and fences old credentials",async()=>{ await withDatabase(erasureLanes); });

import { lifecycleLanes } from "../scripts/lifecycle-lanes.mjs";
test("compiled lifecycle migrates, rolls back and rejects contended late writes",async()=>{ await withDatabase(lifecycleLanes); });

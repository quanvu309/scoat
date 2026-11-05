import { fileURLToPath } from "node:url";
import { migrateAdmitted } from "../dist/db/lineage.js";
import { releaseJournal, applyPending } from "../dist/db/journal.js";

export async function migrateFixtureDatabase(pool) {
 const release = await releaseJournal(fileURLToPath(new URL("../db/migrations", import.meta.url)));
 await migrateAdmitted(pool, client => applyPending(client, release));
}

import { readFile } from "node:fs/promises";
import { startWorker } from "../dist/worker.js";
import { LineageRefused } from "../dist/db/lineage.js";
import { verifyRelease } from "../dist/release.js";
import { watchConfigSchema } from "../dist/memory/watches.js";
import { fixtureDelivery } from "./watch-delivery.mjs";
const verified = await verifyRelease();
if (verified.kind !== "verified") { process.stderr.write(JSON.stringify({ event: "artifact_refused", reason: verified.reason }) + "\n"); process.exit(78); }
const config = watchConfigSchema.parse(JSON.parse(await readFile(process.env.SCOAT_WATCH_CONFIG, "utf8")));
const refuse = error => { process.stderr.write(JSON.stringify({ event: "lineage_refused", reason: error.reason }) + "\n"); process.exit(78); };
const worker = await startWorker({ databaseUrl: process.env.DATABASE_URL, config, delivery: fixtureDelivery(), concurrency: 4, initialPlan: false, refused: refuse }).catch(error => { if (error instanceof LineageRefused) refuse(error); throw error; });
process.send?.({ ready: true, artifact: verified.release.digest });
process.on("SIGTERM", () => { void worker.stop().then(() => process.exit(0)); });

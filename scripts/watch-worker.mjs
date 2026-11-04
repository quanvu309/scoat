import { readFile } from "node:fs/promises";
import { startWorker } from "../dist/worker.js";
import { watchConfigSchema } from "../dist/memory/watches.js";
import { fixtureDelivery } from "./watch-delivery.mjs";
const config = watchConfigSchema.parse(JSON.parse(await readFile(process.env.SCOAT_WATCH_CONFIG, "utf8")));
const worker = await startWorker({ databaseUrl: process.env.DATABASE_URL, config, delivery: fixtureDelivery(), concurrency: 4, initialPlan: false });
process.send?.({ ready: true });
process.on("SIGTERM", () => { void worker.stop().then(() => process.exit(0)); });

import pg from "pg";
import { admitTarget } from "../dist/recovery/handoff.js";

const source = new pg.Pool({ connectionString: process.env.SCOAT_SOURCE_DATABASE_URL, max: 2 });
const target = new pg.Pool({ connectionString: process.env.SCOAT_TARGET_DATABASE_URL, max: 2 });
const hold = setInterval(() => undefined, 1000);
const result = await admitTarget({ source, target, migrations: new URL("../db/migrations", import.meta.url).pathname, pause: async point => { if (point === process.env.SCOAT_CRASH_POINT) { process.send?.({ paused: point }); await new Promise(() => undefined); } } });
clearInterval(hold);
process.send?.({ result });

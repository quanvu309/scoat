import { readFileSync } from "node:fs";
export const watchSchema = readFileSync(new URL("../../db/migrations/0003_watches.sql", import.meta.url), "utf8");

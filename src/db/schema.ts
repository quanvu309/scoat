import { readFile } from "node:fs/promises";
export const durableMigrations = ["0001_hunts", "0002_memory_lifecycle", "0003_watches", "0004_lineage"] as const;
export async function durableSchema(): Promise<string> {
 const parts = await Promise.all(durableMigrations.map(tag => readFile(new URL("../../db/migrations/" + tag + ".sql", import.meta.url), "utf8")));
 return parts.join("");
}

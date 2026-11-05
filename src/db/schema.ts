import { readFile } from "node:fs/promises";
export async function durableSchema(): Promise<string> {
 return await readFile(new URL("../../db/migrations/0001_hunts.sql",import.meta.url),"utf8") + await readFile(new URL("../../db/migrations/0002_memory_lifecycle.sql",import.meta.url),"utf8") + await readFile(new URL("../../db/migrations/0003_watches.sql",import.meta.url),"utf8");
}

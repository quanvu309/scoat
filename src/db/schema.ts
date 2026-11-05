import { readFile } from "node:fs/promises";
export async function durableSchema(): Promise<string> {
  return readFile(new URL("../../db/migrations/0001_hunts.sql",import.meta.url),"utf8");
}

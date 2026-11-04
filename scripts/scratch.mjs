import { mkdir, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function scratchDirectory(prefix, root = path.join(os.homedir(), "tmp")) {
  await mkdir(root, { recursive: true });
  return mkdtemp(path.join(root, prefix));
}

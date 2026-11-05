import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export const releaseManifest = "dist/release.json";
export const releaseDirectories = ["dist", "db/migrations", "knowledge/releases"] as const;
export const releaseFiles = ["package.json", "package-lock.json", "scripts/database.mjs"] as const;
export type ReleaseRefusal = "artifact-metadata-absent" | "artifact-metadata-malformed" | "artifact-inputs-changed";
export type ReleaseState = Readonly<{ kind: "verified"; release: Release }> | Readonly<{ kind: "refused"; reason: ReleaseRefusal }>;
type ReleaseInput = Readonly<{ path: string; sha256: string }>;

const shippedRoot = fileURLToPath(new URL("..", import.meta.url));
const digestPattern = /^sha256:[0-9a-f]{64}$/;
const manifestSchema = z.strictObject({
 format: z.literal("scoat-release/1"),
 digest: z.string().regex(digestPattern),
 inputs: z.array(z.strictObject({ path: z.string().min(1).max(512), sha256: z.string().regex(/^[0-9a-f]{64}$/) })).min(1).max(10000),
});

let mint: (digest: string) => Release;

export class Release {
 private constructor(readonly digest: string) {}
 static {
  mint = digest => new Release(digest);
 }
}

class UnsupportedInput extends Error {}

const hash = (data: Buffer | string): string => createHash("sha256").update(data).digest("hex");

function digestOf(inputs: readonly ReleaseInput[]): string {
 return "sha256:" + hash(inputs.map(input => input.path + "\0" + input.sha256 + "\n").join(""));
}

async function filesUnder(root: string, relative: string): Promise<string[]> {
 const entries = await readdir(path.join(root, relative), { withFileTypes: true });
 const found: string[] = [];
 for (const entry of entries) {
  const child = path.posix.join(relative, entry.name);
  if (entry.isDirectory()) found.push(...await filesUnder(root, child));
  else if (entry.isFile()) found.push(child);
  else throw new UnsupportedInput(child);
 }
 return found;
}

async function collect(root: string): Promise<ReleaseInput[]> {
 const names: string[] = [...releaseFiles];
 for (const directory of releaseDirectories) names.push(...await filesUnder(root, directory));
 const inputs: ReleaseInput[] = [];
 for (const name of names.filter(name => name !== releaseManifest).sort()) inputs.push({ path: name, sha256: hash(await readFile(path.join(root, name))) });
 return inputs;
}

export async function recordRelease(root: string = shippedRoot): Promise<string> {
 const inputs = await collect(root);
 const digest = digestOf(inputs);
 await writeFile(path.join(root, releaseManifest), JSON.stringify({ format: "scoat-release/1", digest, inputs }, null, 1) + "\n");
 return digest;
}

export async function verifyRelease(root: string = shippedRoot): Promise<ReleaseState> {
 let text: string;
 try {
  text = await readFile(path.join(root, releaseManifest), "utf8");
 } catch {
  return { kind: "refused", reason: "artifact-metadata-absent" };
 }
 let raw: unknown;
 try {
  raw = JSON.parse(text);
 } catch {
  return { kind: "refused", reason: "artifact-metadata-malformed" };
 }
 const manifest = manifestSchema.safeParse(raw);
 if (!manifest.success || digestOf(manifest.data.inputs) !== manifest.data.digest) return { kind: "refused", reason: "artifact-metadata-malformed" };
 let current: string;
 try {
  current = digestOf(await collect(root));
 } catch {
  return { kind: "refused", reason: "artifact-inputs-changed" };
 }
 if (current !== manifest.data.digest) return { kind: "refused", reason: "artifact-inputs-changed" };
 return { kind: "verified", release: mint(current) };
}

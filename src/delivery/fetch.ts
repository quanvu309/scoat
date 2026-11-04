import { lookup } from "node:dns/promises";
import { BlockList, isIPv4, isIPv6 } from "node:net";
import type { LookupFunction } from "node:net";
import { request } from "node:https";
import type { IncomingMessage } from "node:http";
import { createHash } from "node:crypto";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import type { Transform } from "node:stream";

export const fetchLimits = { overallMilliseconds: 10000, redirects: 3, bytes: 2 * 1024 * 1024 } as const;
export type FetchFailureReason = "blocked-destination" | "redirect-refused" | "too-many-redirects" | "http-status" | "oversized" | "timeout" | "network";
export class FetchFailure extends Error {
 constructor(readonly reason: FetchFailureReason) { super(reason); }
}
export type PinnedAddress = Readonly<{ address: string; family: 4 | 6; port: number }>;
export type AddressPolicy = (host: string) => Promise<PinnedAddress>;
export type FetchedPage = Readonly<{ url: string; body: Buffer; sha256: string }>;

const privateV4 = new BlockList();
for (const [address, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]] as const) privateV4.addSubnet(address, prefix, "ipv4");
const privateV6 = new BlockList();
for (const [address, prefix] of [["::", 96], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64], ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8]] as const) privateV6.addSubnet(address, prefix, "ipv6");

function ipv6Words(address: string): number[] | null {
 const zone = address.indexOf("%");
 const plain = zone === -1 ? address : address.slice(0, zone);
 const tail = plain.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
 const head = tail?.[1] ?? plain;
 const dotted = tail?.[2];
 let extra: number[] = [];
 if (dotted !== undefined) {
  if (!isIPv4(dotted)) return null;
  const parts = dotted.split(".").map(Number);
  extra = [((parts[0] ?? 0) << 8) | (parts[1] ?? 0), ((parts[2] ?? 0) << 8) | (parts[3] ?? 0)];
 }
 const source = dotted === undefined ? head : head.endsWith("::") ? head : head.slice(0, -1);
 const halves = source.split("::");
 if (halves.length > 2) return null;
 const parse = (part: string | undefined) => part ? part.split(":").map(word => /^[0-9a-f]{1,4}$/i.test(word) ? Number.parseInt(word, 16) : Number.NaN) : [];
 const left = parse(halves[0]), right = parse(halves[1]);
 const missing = 8 - left.length - right.length - extra.length;
 if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
 const words = [...left, ...Array.from({ length: halves.length === 1 ? 0 : missing }, () => 0), ...right, ...extra];
 return words.length === 8 && words.every(word => Number.isInteger(word) && word >= 0 && word <= 0xffff) ? words : null;
}

export function publicAddress(address: string): boolean {
 if (isIPv4(address)) return !privateV4.check(address, "ipv4");
 if (!isIPv6(address)) return false;
 const words = ipv6Words(address);
 if (!words) return false;
 if (words.slice(0, 5).every(word => word === 0) && words[5] === 0xffff) {
  const embedded = [(words[6] ?? 0) >> 8, (words[6] ?? 0) & 255, (words[7] ?? 0) >> 8, (words[7] ?? 0) & 255].join(".");
  return !privateV4.check(embedded, "ipv4");
 }
 if (words.every((word, index) => index === 7 ? word <= 1 : word === 0)) return false;
 return !privateV6.check(address, "ipv6");
}

export const publicDns: AddressPolicy = async host => {
 const answers = await lookup(host, { all: true, verbatim: true });
 const first = answers[0];
 if (!first || answers.some(answer => !publicAddress(answer.address))) throw new FetchFailure("blocked-destination");
 return { address: first.address, family: first.family === 6 ? 6 : 4, port: 443 };
};

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
 if (signal.aborted) return Promise.reject(new FetchFailure("timeout"));
 return new Promise((resolve, reject) => {
  const abort = () => reject(new FetchFailure("timeout"));
  signal.addEventListener("abort", abort, { once: true });
  promise.then(value => { signal.removeEventListener("abort", abort); resolve(value); }, error => { signal.removeEventListener("abort", abort); reject(error); });
 });
}

function decoder(encoding: string | undefined): Transform | null {
 if (!encoding || encoding === "identity") return null;
 if (encoding === "gzip") return createGunzip();
 if (encoding === "br") return createBrotliDecompress();
 if (encoding === "deflate") return createInflate();
 throw new FetchFailure("network");
}

async function boundedBody(response: IncomingMessage, signal: AbortSignal): Promise<Buffer> {
 const decode = decoder(response.headers["content-encoding"]);
 const stream = decode ? response.pipe(decode) : response;
 const chunks: Buffer[] = [];
 let size = 0;
 return abortable((async () => {
  for await (const chunk of stream) {
   const piece = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
   size += piece.length;
   if (size > fetchLimits.bytes) { response.destroy(); throw new FetchFailure("oversized"); }
   chunks.push(piece);
  }
  return Buffer.concat(chunks);
 })(), signal);
}

function get(url: URL, pinned: PinnedAddress, signal: AbortSignal): Promise<IncomingMessage> {
 const pin: LookupFunction = (_host, options, callback) => {
  if (options.all) callback(null, [{ address: pinned.address, family: pinned.family }]);
  else callback(null, pinned.address, pinned.family);
 };
 return new Promise((resolve, reject) => {
  const outgoing = request({ protocol: "https:", hostname: url.hostname, port: pinned.port, path: url.pathname + url.search, method: "GET", servername: url.hostname, lookup: pin, agent: false, rejectUnauthorized: true, signal, headers: { accept: "text/html", "accept-encoding": "gzip, br, deflate", "user-agent": "ScoatPublicWatch/1" } }, resolve);
  outgoing.on("error", error => reject(signal.aborted ? new FetchFailure("timeout") : new FetchFailure("network")));
  outgoing.end();
 });
}

export async function fetchPublic(start: string, hosts: ReadonlySet<string>, resolve: AddressPolicy, signal: AbortSignal): Promise<FetchedPage> {
 let current = new URL(start);
 for (let hop = 0; ; hop++) {
  if (current.protocol !== "https:" || current.username || current.password || current.port !== "" || !hosts.has(current.hostname)) throw new FetchFailure(hop ? "redirect-refused" : "blocked-destination");
  const pinned = await abortable(resolve(current.hostname), signal);
  const response = await get(current, pinned, signal);
  const status = response.statusCode ?? 0;
  if ([301, 302, 303, 307, 308].includes(status)) {
   response.resume();
   const location = response.headers.location;
   if (!location) throw new FetchFailure("redirect-refused");
   if (hop >= fetchLimits.redirects) throw new FetchFailure("too-many-redirects");
   current = new URL(location, current);
   continue;
  }
  if (status !== 200) { response.resume(); throw new FetchFailure("http-status"); }
  const body = await boundedBody(response, signal);
  return { url: current.href, body, sha256: createHash("sha256").update(body).digest("hex") };
 }
}

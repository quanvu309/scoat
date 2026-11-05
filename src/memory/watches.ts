import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type pg from "pg";
import { z } from "zod";
import { retryTransaction } from "../db/transaction.js";
import { basisDigest, cleanShopUrl, observationSchema, submitLimitMilliseconds, watchTargetSchema } from "../delivery/index.js";
import type { Delivery, MailMessage, Observation, PublicWatchTarget } from "../delivery/index.js";
import { pihut } from "../delivery/pihut.js";
import { readFinishedResult } from "../hunt/postgres.js";
import { watchCommandSchema, watchTargetPence } from "./contracts.js";
import { deleteScopedJobs } from "../queue/index.js";
import type { CheckJob, Enqueue, SendJob } from "../queue/index.js";
import type { AccountScope } from "../domain.js";

export const watchLimits = { active: 10, days: 90, freshObservationSeconds: 120, retryHorizonHours: 20, submitMilliseconds: submitLimitMilliseconds, fetchMilliseconds: 10000 } as const;
export const watchConfigSchema = z.strictObject({
 issuer: z.url().refine(value => { const url = new URL(value); return url.protocol === "https:" && url.origin === value; }),
 from: z.string().min(3).max(320),
 unsubscribe: z.strictObject({ version: z.string().regex(/^[a-z0-9-]{1,32}$/), keys: z.record(z.string().regex(/^[a-z0-9-]{1,32}$/), z.string().regex(/^[0-9a-f]{64}$/)) }),
 resendApiKey: z.string().min(1).max(512).nullable(),
}).refine(config => config.unsubscribe.keys[config.unsubscribe.version] !== undefined);
export type WatchConfig = z.infer<typeof watchConfigSchema>;
export type Comparable = Extract<Observation, { kind: "comparable" }>;
export type WatchPause = (point: "observed" | "outbox" | "marked" | "fenced" | "submitted") => Promise<void>;
export type WatchProposal = { kind: "target"; target: PublicWatchTarget } | { kind: "unavailable"; reason: "no-exact-supported-variant" | "ambiguous-variant" };
export const watchRefusalReasons = ["service-unconfigured", "unfinished", "no-exact-supported-variant", "ambiguous-variant", "already-watching", "watch-limit", "invalid-target", "stale", "expired", "recipient-changed"] as const;
export type WatchRefusalReason = typeof watchRefusalReasons[number];
export type PreparedWatch = { kind: "ready"; hunt: string; target: PublicWatchTarget; suggestedPence: number | null; recipient: { revision: string; address: string } | null; otherActive: number } | { kind: "unavailable"; reason: Exclude<WatchRefusalReason, "stale" | "expired" | "recipient-changed"> };
export type WatchEntry = { available: true; url: string } | { available: false; reason: string };
export const watchRefusalText: Readonly<Record<WatchRefusalReason, string>> = {
 "service-unconfigured": "Price watches are not configured on this Scoat server.",
 unfinished: "Finish the hunt first; a price watch starts from a finished result.",
 "no-exact-supported-variant": "Price watches support only The Pi Hut Raspberry Pi 5 with one exact variant link, quantity one and UK Royal Mail 1st Class delivery.",
 "ambiguous-variant": "The finished result links more than one Pi Hut variant, so the exact item to watch is unclear.",
 "already-watching": "This finished hunt already has an active price watch.",
 "watch-limit": "This account already has the maximum number of active price watches.",
 "invalid-target": "Enter a target from GBP 0.01 to GBP 100000.00. Nothing was activated; correct the amount and submit the confirmation again.",
 stale: "The public price shown is more than two minutes old or the item changed. Nothing was activated.",
 expired: "This confirmation expired or was already used. Nothing new was activated.",
 "recipient-changed": "The alert address changed since this page was shown, or moving alerts to the new address was not confirmed. Nothing was activated.",
};
export class WatchRefusal extends Error {
 constructor(readonly reason: WatchRefusalReason) { super("Watch refused: " + reason); }
}
export type SendOutcome = "accepted" | "rejected" | "ambiguous" | "refused" | "expired" | "settled";
export type CheckOutcome = { kind: "inactive" | "duplicate" } | { kind: "observed"; observation: Observation; alert: string | null; outboxMilliseconds: number };

const watchRow = z.object({ id: z.uuid(), hunt: z.string(), target: z.unknown(), basis_digest: z.string(), baseline_pence: z.number().int(), target_pence: z.number().int(), recipient_revision: z.uuid(), key_version: z.string(), status: z.enum(["active", "cancelled", "expired"]), baseline_observed_at: z.date(), created_at: z.date(), expires_at: z.date(), ended_at: z.date().nullable() });
const alertState = z.enum(["pending", "submitting", "accepted", "rejected", "cancelled", "unconfirmed"]);
const recipientRow = z.object({ revision: z.uuid(), address: z.email() });
const messageSchema = z.strictObject({ from: z.string(), subject: z.string(), text: z.string(), html: z.string(), headers: z.record(z.string(), z.string()) });
const reserving = "('pending','submitting','accepted','unconfirmed')";
const pounds = (pence: number) => "GBP " + (pence / 100).toFixed(2);
const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;");

async function activeAccount(client: pg.PoolClient, scope: AccountScope, mode: "SHARE" | "UPDATE"): Promise<boolean> {
 return Boolean((await client.query(`SELECT 1 FROM hunt_accounts WHERE account=$1 AND incarnation=$2 AND NOT erased FOR ${mode}`, [scope.account, scope.incarnation])).rowCount);
}

export function resolveWatchTarget(snapshot: unknown): WatchProposal {
 const variants = new Set<number>();
 const visit = (value: unknown): void => {
  if (typeof value === "string") {
   if (!value.startsWith("https://")) return;
   const url = URL.parse(value);
   const variant = Number(url?.searchParams.get("variant"));
   if (url?.origin + (url?.pathname ?? "") === pihut.product && pihut.variants.has(variant)) variants.add(variant);
  } else if (Array.isArray(value)) value.forEach(visit);
  else if (value && typeof value === "object") Object.values(value).forEach(visit);
 };
 visit(snapshot);
 const [variant] = variants;
 if (variants.size > 1) return { kind: "unavailable", reason: "ambiguous-variant" };
 const known = variant === undefined ? undefined : pihut.variants.get(variant);
 if (variant === undefined || !known) return { kind: "unavailable", reason: "no-exact-supported-variant" };
 return { kind: "target", target: watchTargetSchema.parse({ parser: pihut.parser, seller: pihut.seller, url: pihut.product, variant, sku: known.sku, quantity: 1, delivery: { destination: "GB", service: pihut.service, rule: pihut.rule, lithium: false, membership: "none" } }) };
}

export function watchUrl(issuer: string, account: string, hunt: string): string {
 return issuer + "/account/watch?account=" + encodeURIComponent(account) + "&hunt=" + encodeURIComponent(hunt);
}

export function watchEntry(issuer: string | null, account: string, view: Readonly<{ hunt: string; final: Readonly<{ kind: string }> }>): WatchEntry {
 if (issuer === null) return { available: false, reason: watchRefusalText["service-unconfigured"] };
 if (view.final.kind !== "finished") return { available: false, reason: watchRefusalText.unfinished };
 const resolved = resolveWatchTarget(view);
 if (resolved.kind === "unavailable") return { available: false, reason: watchRefusalText[resolved.reason] };
 return { available: true, url: watchUrl(issuer, account, view.hunt) };
}

export async function prepareWatch(client: pg.PoolClient, scope: AccountScope, hunt: string): Promise<PreparedWatch> {
 const prefix = [scope.account, scope.incarnation];
 const finished = await readFinishedResult(client, scope, hunt);
 if (!finished) return { kind: "unavailable", reason: "unfinished" };
 const resolved = resolveWatchTarget(finished.snapshot);
 if (resolved.kind === "unavailable") return resolved;
 const active = (await client.query("SELECT hunt FROM watches WHERE account=$1 AND incarnation=$2 AND status='active'", prefix)).rows.map(row => z.string().parse(row.hunt));
 if (active.includes(hunt)) return { kind: "unavailable", reason: "already-watching" };
 if (active.length >= watchLimits.active) return { kind: "unavailable", reason: "watch-limit" };
 const proposal = (await client.query("SELECT command FROM memory_commands WHERE account=$1 AND incarnation=$2 AND command->>'op'='watch' AND command->>'hunt'=$3 AND outcome IS NULL AND expires_at>now() ORDER BY expires_at DESC LIMIT 1", [...prefix, hunt])).rows[0];
 const recipient = (await client.query("SELECT revision,address FROM watch_recipients WHERE account=$1 AND incarnation=$2", prefix)).rows[0];
 return { kind: "ready", hunt, target: resolved.target, suggestedPence: proposal ? watchCommandSchema.parse(proposal.command).target.pence : null, recipient: recipient ? recipientRow.parse(recipient) : null, otherActive: active.length };
}

export function maskAddress(address: string): string {
 const [local = "", domain = ""] = address.split("@");
 return (local.slice(0, 1) || "*") + "***@" + domain;
}

export function signUnsubscribe(config: WatchConfig, version: string, scope: AccountScope, watch: string): string {
 const key = config.unsubscribe.keys[version];
 if (!key) throw new Error("Unknown unsubscribe key version");
 const payload = Buffer.from(JSON.stringify([version, scope.account, scope.incarnation, watch])).toString("base64url");
 return payload + "." + createHmac("sha256", Buffer.from(key, "hex")).update("scoat-unsubscribe-v1:" + payload).digest("base64url");
}

export function readUnsubscribe(config: WatchConfig, token: string): (AccountScope & { watch: string }) | null {
 const parts = token.split(".");
 const [payload, mac] = parts;
 if (parts.length !== 2 || !payload || !mac || token.length > 512) return null;
 const fields = z.tuple([z.string(), z.uuid(), z.uuid(), z.uuid()]).safeParse((() => { try { return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch { return null; } })());
 if (!fields.success) return null;
 const [version, account, incarnation, watch] = fields.data;
 const key = config.unsubscribe.keys[version];
 if (!key) return null;
 const expected = createHmac("sha256", Buffer.from(key, "hex")).update("scoat-unsubscribe-v1:" + payload).digest();
 const actual = Buffer.from(mac, "base64url");
 if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
 return { account: z.uuid().brand<"AccountId">().parse(account), incarnation: z.uuid().brand<"Incarnation">().parse(incarnation), watch };
}

export function alertMessage(config: WatchConfig, target: PublicWatchTarget, observation: Comparable, observedAt: Date, baselinePence: number, targetPence: number, unsubscribeUrl: string): MailMessage {
 const title = "Raspberry Pi 5 " + (pihut.variants.get(target.variant)?.title ?? "") + " (" + target.sku + ")";
 const lines = [
  `${title} is ${pounds(observation.amountPence)} delivered at ${target.seller}.`,
  `Basis: item ${pounds(observation.itemPence)} + Royal Mail 1st Class UK delivery ${pounds(observation.deliveryPence)}, quantity one, in stock, public non-member price.`,
  `Observed at ${observedAt.toISOString()} from the public product and delivery pages.`,
  `Your target: ${pounds(targetPence)}. Public baseline when you confirmed: ${pounds(baselinePence)}.`,
  `Shop: ${cleanShopUrl(target)}`,
  "Conditions: prices and stock can change before checkout. Scoat did not check out, apply discounts, coupons, cashback, student or member pricing, or verify lithium shipping surcharges.",
  `Stop this watch: ${unsubscribeUrl}`,
 ];
 return {
  from: config.from,
  subject: `Scoat watch: ${title} now ${pounds(observation.amountPence)} delivered`,
  text: lines.join("\n"),
  html: "<!doctype html><html><body>" + lines.map(line => `<p>${escape(line)}</p>`).join("").replace(escape(cleanShopUrl(target)), `<a href="${escape(cleanShopUrl(target))}">${escape(cleanShopUrl(target))}</a>`).replace(escape(unsubscribeUrl), `<a href="${escape(unsubscribeUrl)}">${escape(unsubscribeUrl)}</a>`) + "</body></html>",
  headers: { "List-Unsubscribe": `<${unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
 };
}

export async function cancelWatch(client: pg.PoolClient, scope: AccountScope, watch: string) {
 const prefix = [scope.account, scope.incarnation, watch];
 const row = (await client.query("SELECT status FROM watches WHERE account=$1 AND incarnation=$2 AND id=$3 FOR UPDATE", prefix)).rows[0];
 const wasActive = row?.status === "active";
 if (wasActive) await client.query("UPDATE watches SET status='cancelled',ended_at=clock_timestamp() WHERE account=$1 AND incarnation=$2 AND id=$3", prefix);
 if (row) {
  await client.query("UPDATE watch_alerts SET state='cancelled',outcome_at=clock_timestamp(),last_error='cancelled-before-submission' WHERE account=$1 AND incarnation=$2 AND watch=$3 AND state='pending'", prefix);
  await client.query("UPDATE watch_alerts SET state='unconfirmed',outcome_at=clock_timestamp(),last_error='cancelled-after-submission-marker' WHERE account=$1 AND incarnation=$2 AND watch=$3 AND state='submitting'", prefix);
 }
 const jobs = await deleteScopedJobs(client, { ...scope, watch });
 const counts = (await client.query("SELECT count(*) FILTER (WHERE state='accepted')::integer AS accepted,count(*) FILTER (WHERE state='unconfirmed')::integer AS unresolved FROM watch_alerts WHERE account=$1 AND incarnation=$2 AND watch=$3", prefix)).rows[0];
 return { kind: "unwatched" as const, watch, wasActive, jobs, acceptedAlerts: z.number().int().parse(counts?.accepted ?? 0), mayStillArrive: z.number().int().parse(counts?.unresolved ?? 0) };
}

export async function readWatches(client: pg.PoolClient, scope: AccountScope) {
 const rows = (await client.query("SELECT id,hunt,target,basis_digest,baseline_pence,target_pence,recipient_revision,key_version,status,baseline_observed_at,created_at,expires_at,ended_at FROM watches WHERE account=$1 AND incarnation=$2 ORDER BY created_at DESC LIMIT 20", [scope.account, scope.incarnation])).rows.map(row => watchRow.parse(row));
 const alerts = (await client.query("SELECT watch,day::text AS day,amount_pence,state,attempts,deadline,last_error FROM watch_alerts WHERE account=$1 AND incarnation=$2 ORDER BY created_at", [scope.account, scope.incarnation])).rows;
 const current = (await client.query("SELECT revision FROM watch_recipients WHERE account=$1 AND incarnation=$2", [scope.account, scope.incarnation])).rows[0]?.revision ?? null;
 const latest = (await client.query("SELECT DISTINCT ON (watch) watch,day::text AS day,observation,observed_at FROM watch_observations WHERE account=$1 AND incarnation=$2 ORDER BY watch,day DESC", [scope.account, scope.incarnation])).rows;
 return {
  kind: "watches" as const,
  limits: { active: watchLimits.active, days: watchLimits.days, schedule: "daily 00:05 UTC", fetchSeconds: watchLimits.fetchMilliseconds / 1000, retryHorizonHours: watchLimits.retryHorizonHours },
  items: rows.map(row => {
   const target = watchTargetSchema.parse(row.target);
   const mine = alerts.filter(alert => alert.watch === row.id);
   const observed = latest.find(item => item.watch === row.id);
   return {
    watch: row.id, hunt: row.hunt, status: row.status, alertsCurrentRecipient: row.recipient_revision === current, expiresAt: row.expires_at.toISOString(),
    item: { seller: target.seller, url: cleanShopUrl(target), sku: target.sku, variant: target.variant },
    basis: { currency: "GBP", delivery: "UK Royal Mail 1st Class, quantity one, non-member, non-lithium", digest: row.basis_digest },
    baseline: { pence: row.baseline_pence, observedAt: row.baseline_observed_at.toISOString(), source: "public observation at confirmation" },
    target: { pence: row.target_pence },
    lastObservation: observed ? { day: observed.day, observation: observationSchema.parse(observed.observation) } : null,
    alerts: mine.map(alert => ({ day: alert.day, pence: alert.amount_pence, state: alertState.parse(alert.state), attempts: alert.attempts, reason: z.string().nullable().parse(alert.last_error) })),
    mayStillArrive: mine.filter(alert => alert.state === "submitting" || alert.state === "unconfirmed").length,
   };
  }),
 };
}

export async function deleteWatches(client: pg.PoolClient, scope: AccountScope) {
 const prefix = [scope.account, scope.incarnation];
 const unresolved = z.number().int().parse((await client.query("SELECT count(*)::integer AS count FROM watch_alerts WHERE account=$1 AND incarnation=$2 AND state IN ('submitting','unconfirmed')", prefix)).rows[0]?.count);
 await client.query("SELECT id FROM watches WHERE account=$1 AND incarnation=$2 ORDER BY id FOR UPDATE", prefix);
 const counts: Record<string, number> = {};
 for (const table of ["watch_alerts", "watch_observations", "watches", "watch_recipients"]) {
  counts[table] = (await client.query(`DELETE FROM ${table} WHERE account=$1 AND incarnation=$2`, prefix)).rowCount ?? 0;
  if ((await client.query(`SELECT 1 FROM ${table} WHERE account=$1 AND incarnation=$2 LIMIT 1`, prefix)).rowCount) throw new Error("Watch erasure survivor");
 }
 counts.queue_jobs = await deleteScopedJobs(client, scope);
 return { counts, mayStillArrive: unresolved };
}

export class Watches {
 constructor(private readonly deps: Readonly<{ pool: pg.Pool; delivery: Delivery; config: WatchConfig; enqueue: Enqueue | null; pause?: WatchPause }>) {}

 get available(): boolean {
  return this.deps.config.resendApiKey !== null;
 }

 get issuer(): string {
  return this.deps.config.issuer;
 }

 async prepare(scope: AccountScope, hunt: string): Promise<PreparedWatch> {
  if (!this.available) return { kind: "unavailable", reason: "service-unconfigured" };
  return retryTransaction(this.deps.pool, async client => {
   if (!await activeAccount(client, scope, "SHARE")) throw new Error("Inactive account incarnation");
   return prepareWatch(client, scope, hunt);
  });
 }

 private async pause(point: Parameters<WatchPause>[0]) {
  if (this.deps.pause) await this.deps.pause(point);
 }

 async observe(target: PublicWatchTarget): Promise<Observation> {
  return this.deps.delivery.observe(target, AbortSignal.timeout(watchLimits.fetchMilliseconds));
 }

 async activate(client: pg.PoolClient, input: Readonly<{ scope: AccountScope; hunt: string; target: PublicWatchTarget; targetPence: number; observation: Comparable; observedAt: number; address: string; expectedRecipient: string | null; moveRecipient: boolean }>) {
  if (!this.available) throw new WatchRefusal("service-unconfigured");
  const { scope } = input;
  const prefix = [scope.account, scope.incarnation];
  if (!await activeAccount(client, scope, "SHARE")) throw new Error("Inactive account incarnation");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["scoat-watch-limit:" + scope.account + ":" + scope.incarnation]);
  const fresh = (await client.query("SELECT clock_timestamp() - to_timestamp($1/1000.0) <= make_interval(secs => $2) AS fresh", [input.observedAt, watchLimits.freshObservationSeconds])).rows[0]?.fresh;
  if (fresh !== true) throw new WatchRefusal("stale");
  const prepared = await prepareWatch(client, scope, input.hunt);
  if (prepared.kind !== "ready") throw new WatchRefusal(prepared.reason);
  if (JSON.stringify(prepared.target) !== JSON.stringify(input.target) || input.observation.basis.variant !== prepared.target.variant) throw new WatchRefusal("stale");
  const targetPence = watchTargetPence.parse(input.targetPence);
  if ((prepared.recipient?.revision ?? null) !== input.expectedRecipient) throw new WatchRefusal("recipient-changed");
  const moving = prepared.recipient !== null && prepared.recipient.address !== input.address;
  if (moving && prepared.otherActive > 0 && !input.moveRecipient) throw new WatchRefusal("recipient-changed");
  const revision = prepared.recipient && !moving ? prepared.recipient.revision : randomUUID();
  if (moving) {
   await client.query("SELECT id FROM watches WHERE account=$1 AND incarnation=$2 AND status='active' ORDER BY id FOR UPDATE", prefix);
   await client.query("UPDATE watches SET recipient_revision=$3 WHERE account=$1 AND incarnation=$2 AND status='active'", [...prefix, revision]);
   await client.query("UPDATE watch_alerts SET recipient_revision=$3 WHERE account=$1 AND incarnation=$2 AND state='pending'", [...prefix, revision]);
  }
  const watch = randomUUID();
  await client.query("INSERT INTO watches(account,incarnation,id,hunt,target,basis,basis_digest,baseline_pence,baseline_observed_at,target_pence,recipient_revision,key_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,to_timestamp($9/1000.0),$10,$11,$12)", [...prefix, watch, prepared.hunt, prepared.target, input.observation.basis, basisDigest(input.observation), input.observation.amountPence, input.observedAt, targetPence, revision, this.deps.config.unsubscribe.version]);
  await client.query("INSERT INTO watch_recipients(account,incarnation,revision,address) VALUES($1,$2,$3,$4) ON CONFLICT(account,incarnation) DO UPDATE SET revision=EXCLUDED.revision,address=EXCLUDED.address,verified_at=now()", [...prefix, revision, input.address]);
  await client.query("UPDATE memory_commands SET outcome=$4,command=NULL WHERE account=$1 AND incarnation=$2 AND command->>'op'='watch' AND command->>'hunt'=$3 AND outcome IS NULL", [...prefix, prepared.hunt, { kind: "watching", watch }]);
  return { watch, baselinePence: input.observation.amountPence, targetPence, movedWatches: moving ? prepared.otherActive : 0 };
 }

 async unsubscribe(token: string) {
  const parsed = readUnsubscribe(this.deps.config, token);
  if (!parsed) return { kind: "inactive" as const };
  return retryTransaction(this.deps.pool, async client => {
   if (!await activeAccount(client, parsed, "SHARE")) return { kind: "inactive" as const };
   const result = await cancelWatch(client, parsed, parsed.watch);
   return result.wasActive ? { kind: "unsubscribed" as const, mayStillArrive: result.mayStillArrive } : { kind: "inactive" as const };
  });
 }

 async plan(): Promise<{ checks: number; sends: number; expired: number }> {
  const enqueue = this.deps.enqueue;
  if (!enqueue) throw new Error("Queue unavailable");
  const total = { checks: 0, sends: 0, expired: 0 };
  let cursor: { account: string; incarnation: string } | null = null;
  for (;;) {
   const page = await retryTransaction(this.deps.pool, async client => {
    const day = z.string().parse((await client.query("SELECT ((now() AT TIME ZONE 'UTC')::date)::text AS day")).rows[0]?.day);
    const accounts = z.array(z.strictObject({ account: z.string(), incarnation: z.uuid() })).parse((await client.query("SELECT a.account,a.incarnation FROM hunt_accounts a WHERE NOT a.erased AND ($1::text IS NULL OR (a.account,a.incarnation)>($1::text,$2::uuid)) AND (EXISTS (SELECT 1 FROM watches w WHERE w.account=a.account AND w.incarnation=a.incarnation AND w.status='active') OR EXISTS (SELECT 1 FROM watch_alerts l WHERE l.account=a.account AND l.incarnation=a.incarnation AND l.state IN ('pending','submitting'))) ORDER BY a.account,a.incarnation LIMIT 100 FOR SHARE", [cursor?.account ?? null, cursor?.incarnation ?? null])).rows);
    const fenced = [accounts.map(row => row.account), accounts.map(row => row.incarnation)];
    const scoped = "(account,incarnation) IN (SELECT * FROM unnest($1::text[],$2::uuid[]))";
    const ended = await client.query(`UPDATE watches SET status='expired',ended_at=clock_timestamp() WHERE ${scoped} AND status='active' AND expires_at<=now()`, fenced);
    await client.query(`SELECT w.id FROM watches w WHERE ${scoped} AND EXISTS (SELECT 1 FROM watch_alerts l WHERE l.account=w.account AND l.incarnation=w.incarnation AND l.watch=w.id AND l.state IN ('pending','submitting') AND l.deadline<=clock_timestamp()) ORDER BY w.account,w.incarnation,w.id FOR SHARE`, fenced);
    await client.query(`UPDATE watch_alerts SET state=CASE WHEN state='pending' THEN 'cancelled' ELSE 'unconfirmed' END,outcome_at=clock_timestamp(),last_error='retry-horizon' WHERE ${scoped} AND state IN ('pending','submitting') AND deadline<=clock_timestamp()`, fenced);
    const due = (await client.query(`SELECT w.account,w.incarnation,w.id FROM watches w WHERE ${scoped} AND w.status='active' AND NOT EXISTS (SELECT 1 FROM watch_observations o WHERE o.account=w.account AND o.incarnation=w.incarnation AND o.watch=w.id AND o.day=$3::date) ORDER BY w.account,w.incarnation,w.id`, [...fenced, day])).rows;
    for (const row of due) await enqueue.check(client, { account: row.account, incarnation: row.incarnation, watch: row.id, day });
    const open = (await client.query(`SELECT account,incarnation,watch,id FROM watch_alerts WHERE ${scoped} AND state IN ('pending','submitting') AND deadline>clock_timestamp() ORDER BY account,incarnation,id`, fenced)).rows;
    for (const row of open) await enqueue.send(client, { account: row.account, incarnation: row.incarnation, watch: row.watch, alert: row.id });
    return { checks: due.length, sends: open.length, expired: ended.rowCount ?? 0, last: accounts.at(-1), size: accounts.length };
   });
   total.checks += page.checks;
   total.sends += page.sends;
   total.expired += page.expired;
   if (!page.last || page.size < 100) return total;
   cursor = page.last;
  }
 }

 async check(job: CheckJob): Promise<CheckOutcome> {
  const enqueue = this.deps.enqueue;
  if (!enqueue) throw new Error("Queue unavailable");
  const scope = { account: z.uuid().brand<"AccountId">().parse(job.account), incarnation: z.uuid().brand<"Incarnation">().parse(job.incarnation) };
  const ids = [job.account, job.incarnation, job.watch];
  const before = await retryTransaction(this.deps.pool, async client => {
   if (!await activeAccount(client, scope, "SHARE")) return null;
   const row = (await client.query("SELECT target FROM watches WHERE account=$1 AND incarnation=$2 AND id=$3 AND status='active' AND expires_at>now() FOR SHARE", ids)).rows[0];
   if (!row) return null;
   const seen = await client.query("SELECT 1 FROM watch_observations WHERE account=$1 AND incarnation=$2 AND watch=$3 AND day=$4::date", [...ids, job.day]);
   return seen.rowCount ? "duplicate" : watchTargetSchema.parse(row.target);
  });
  if (before === null) return { kind: "inactive" };
  if (before === "duplicate") return { kind: "duplicate" };
  const observation = await this.observe(before);
  await this.pause("observed");
  return retryTransaction(this.deps.pool, async client => {
   const started = performance.now();
   if (!await activeAccount(client, scope, "SHARE")) return { kind: "inactive" as const };
   const watch = (await client.query("SELECT id,hunt,target,basis_digest,baseline_pence,target_pence,recipient_revision,key_version,status,baseline_observed_at,created_at,expires_at,ended_at FROM watches WHERE account=$1 AND incarnation=$2 AND id=$3 FOR UPDATE", ids)).rows[0];
   const parsed = watch ? watchRow.parse(watch) : null;
   if (!parsed || parsed.status !== "active" || parsed.expires_at.getTime() <= Date.now()) return { kind: "inactive" as const };
   const inserted = await client.query("INSERT INTO watch_observations(account,incarnation,watch,day,observation) VALUES($1,$2,$3,$4::date,$5) ON CONFLICT DO NOTHING RETURNING observed_at", [...ids, job.day, observation]);
   const observedAt = inserted.rows[0]?.observed_at;
   if (!(observedAt instanceof Date)) return { kind: "duplicate" as const };
   if (observation.kind !== "comparable" || basisDigest(observation) !== parsed.basis_digest) return { kind: "observed" as const, observation, alert: null, outboxMilliseconds: performance.now() - started };
   const floor = (await client.query(`SELECT min(amount_pence)::integer AS floor FROM watch_alerts WHERE account=$1 AND incarnation=$2 AND watch=$3 AND state IN ${reserving}`, ids)).rows[0]?.floor;
   const amount = observation.amountPence;
   if (!(amount <= parsed.target_pence && amount < parsed.baseline_pence && (floor === null || floor === undefined || amount < Number(floor)))) return { kind: "observed" as const, observation, alert: null, outboxMilliseconds: performance.now() - started };
   const alert = randomUUID();
   const target = watchTargetSchema.parse(parsed.target);
   const unsubscribe = this.deps.config.issuer + "/watch/unsubscribe?token=" + signUnsubscribe(this.deps.config, parsed.key_version, scope, parsed.id);
   const message = alertMessage(this.deps.config, target, observation, observedAt, parsed.baseline_pence, parsed.target_pence, unsubscribe);
   await client.query("INSERT INTO watch_alerts(account,incarnation,id,watch,day,amount_pence,message,provider_key,recipient_revision) VALUES($1,$2,$3,$4,$5::date,$6,$7,$8,$9)", [job.account, job.incarnation, alert, job.watch, job.day, amount, message, "scoat-watch-alert-" + alert, parsed.recipient_revision]);
   await client.query("UPDATE watch_observations SET alert=$5 WHERE account=$1 AND incarnation=$2 AND watch=$3 AND day=$4::date", [...ids, job.day, alert]);
   await this.pause("outbox");
   await enqueue.send(client, { account: job.account, incarnation: job.incarnation, watch: job.watch, alert });
   return { kind: "observed" as const, observation, alert, outboxMilliseconds: performance.now() - started };
  });
 }

 async send(job: SendJob): Promise<SendOutcome> {
  if (!this.deps.delivery.canSubmit) throw new Error("Mail transport unavailable; no submission marker was written");
  const scope = { account: z.uuid().brand<"AccountId">().parse(job.account), incarnation: z.uuid().brand<"Incarnation">().parse(job.incarnation) };
  const ids = [job.account, job.incarnation, job.watch, job.alert];
  const marked = await retryTransaction(this.deps.pool, async client => {
   if (!await activeAccount(client, scope, "SHARE")) return "refused" as const;
   const watch = (await client.query("SELECT status FROM watches WHERE account=$1 AND incarnation=$2 AND id=$3 FOR SHARE", ids.slice(0, 3))).rows[0];
   const alert = (await client.query("SELECT state,clock_timestamp()<deadline AS open FROM watch_alerts WHERE account=$1 AND incarnation=$2 AND watch=$3 AND id=$4 FOR UPDATE", ids)).rows[0];
   if (!alert) return "refused" as const;
   const state = alertState.parse(alert.state);
   if (state !== "pending" && state !== "submitting") return "settled" as const;
   if (watch?.status !== "active" || alert.open !== true) {
    await client.query("UPDATE watch_alerts SET state=CASE WHEN state='pending' THEN 'cancelled' ELSE 'unconfirmed' END,outcome_at=clock_timestamp(),last_error=$5 WHERE account=$1 AND incarnation=$2 AND watch=$3 AND id=$4", [...ids, alert.open === true ? "watch-inactive" : "retry-horizon"]);
    return alert.open === true ? "refused" as const : "expired" as const;
   }
   await client.query("UPDATE watch_alerts SET state='submitting',marked_at=coalesce(marked_at,clock_timestamp()),attempts=attempts+1 WHERE account=$1 AND incarnation=$2 AND watch=$3 AND id=$4", ids);
   return state === "pending" ? "first" as const : "repeat" as const;
  });
  if (marked !== "first" && marked !== "repeat") return marked;
  await this.pause("marked");
  const client = await this.deps.pool.connect();
  const lost = (error: Error) => { process.stderr.write(JSON.stringify({ event: "watch_send_connection_lost", code: "code" in error ? String(error.code) : "unknown" }) + "\n"); };
  client.on("error", lost);
  let outcome: SendOutcome;
  let broken = false;
  try {
   await client.query("BEGIN");
   await client.query("SET LOCAL idle_in_transaction_session_timeout='30s'");
   await client.query("SET LOCAL statement_timeout='30s'");
   await client.query("SET LOCAL lock_timeout='15s'");
   const active = await activeAccount(client, scope, "SHARE");
   const watch = active ? (await client.query("SELECT status,expires_at>now() AS live FROM watches WHERE account=$1 AND incarnation=$2 AND id=$3 FOR SHARE", ids.slice(0, 3))).rows[0] : undefined;
   const alert = active ? (await client.query("SELECT state,message,provider_key,recipient_revision,clock_timestamp()<deadline AS open FROM watch_alerts WHERE account=$1 AND incarnation=$2 AND watch=$3 AND id=$4 FOR UPDATE", ids)).rows[0] : undefined;
   const recipient = alert ? (await client.query("SELECT revision,address FROM watch_recipients WHERE account=$1 AND incarnation=$2 FOR SHARE", ids.slice(0, 2))).rows[0] : undefined;
   if (!active || !alert) { await client.query("ROLLBACK"); return "refused"; }
   if (alertState.parse(alert.state) !== "submitting") { await client.query("ROLLBACK"); return "settled"; }
   if (watch?.status !== "active" || watch.live !== true || alert.open !== true || !recipient || recipient.revision !== alert.recipient_revision) {
    const reason = alert.open !== true ? "retry-horizon" : !recipient || recipient.revision !== alert.recipient_revision ? "recipient-changed" : "watch-inactive";
    await client.query("UPDATE watch_alerts SET state=$5,outcome_at=clock_timestamp(),last_error=$6 WHERE account=$1 AND incarnation=$2 AND watch=$3 AND id=$4", [...ids, marked === "first" ? "cancelled" : "unconfirmed", reason]);
    await client.query("COMMIT");
    return alert.open !== true ? "expired" : "refused";
   }
   await this.pause("fenced");
   const submission = await this.deps.delivery.submit(messageSchema.parse(alert.message), z.email().parse(recipient.address), z.string().parse(alert.provider_key), AbortSignal.timeout(watchLimits.submitMilliseconds));
   await this.pause("submitted");
   if (submission.kind === "accepted") await client.query("UPDATE watch_alerts SET state='accepted',provider_id=$5,outcome_at=clock_timestamp(),last_error=NULL WHERE account=$1 AND incarnation=$2 AND watch=$3 AND id=$4", [...ids, submission.id]);
   else if (submission.kind === "rejected") await client.query("UPDATE watch_alerts SET state=$5,outcome_at=clock_timestamp(),last_error=$6 WHERE account=$1 AND incarnation=$2 AND watch=$3 AND id=$4", [...ids, marked === "first" ? "rejected" : "unconfirmed", "provider-status-" + submission.status]);
   else await client.query("UPDATE watch_alerts SET last_error=$5 WHERE account=$1 AND incarnation=$2 AND watch=$3 AND id=$4", [...ids, "ambiguous-" + submission.reason]);
   await client.query("COMMIT");
   outcome = submission.kind;
  } catch (error) {
   broken = true;
   await client.query("ROLLBACK").catch(() => undefined);
   throw error;
  } finally {
   client.off("error", lost);
   client.release(broken);
  }
  if (outcome === "ambiguous") throw new Error("Provider acceptance is ambiguous; retry with the same key inside the horizon");
  return outcome;
 }
}

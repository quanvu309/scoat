import { createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import type pg from "pg";
import { z } from "zod";
import { retryTransaction } from "../db/transaction.js";
import { Delivery, submitLimitMilliseconds } from "../delivery/index.js";

export class LoginRefused extends Error {}
const addressSchema = z.email().max(254).transform(value => value.toLowerCase());
const identitySchema = z.strictObject({ subject: z.uuid(), email: z.email() });
export const loginSchema = `
CREATE TABLE IF NOT EXISTS login_addresses (
 address_digest text PRIMARY KEY, subject uuid NOT NULL UNIQUE, email text NOT NULL
);
CREATE TABLE IF NOT EXISTS login_challenges (
 state text PRIMARY KEY REFERENCES oauth_browser_flows ON DELETE CASCADE,
 subject uuid NOT NULL REFERENCES login_addresses(subject) ON DELETE CASCADE,
 browser text NOT NULL, purpose text NOT NULL, code_digest text NOT NULL,
 attempts integer NOT NULL DEFAULT 0, accepted boolean NOT NULL DEFAULT false,
 expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS login_sessions (
 digest text PRIMARY KEY, subject uuid NOT NULL REFERENCES login_addresses(subject) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS login_suppression (
 address_digest text PRIMARY KEY, suppressed_at timestamptz NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS login_mail_budget (
 bucket text NOT NULL, window_start timestamptz NOT NULL, used integer NOT NULL,
 PRIMARY KEY(bucket,window_start)
);
`;
export class Login {
 constructor(private readonly pool: pg.Pool, private readonly key: string, private readonly from: string, private readonly delivery: Delivery) {
  if (!delivery.canSubmit) throw new LoginRefused("Sign-in requires a mail transport");
 }
 hash(value: string): string {
  return createHmac("sha256", this.key).update(value).digest("hex");
 }
 async send(state: string, browser: string, purpose: string, rawAddress: string): Promise<boolean> {
  const address = addressSchema.safeParse(rawAddress);
  if (!address.success) return false;
  const code = randomInt(0, 1000000).toString().padStart(6, "0");
  const reservation = await retryTransaction(this.pool, async client => {
   await client.query("SELECT pg_advisory_xact_lock(80110)");
   const flow = await client.query("SELECT data FROM oauth_browser_flows WHERE state=$1 AND data->>'browser'=$2 AND data->'context'->>'stage'=$3 AND expires_at>clock_timestamp() FOR UPDATE", [state, browser, purpose]);
   if (!flow.rowCount) return null;
   const suppressed = await client.query("SELECT 1 FROM login_suppression WHERE address_digest=$1 AND expires_at>clock_timestamp() AND suppressed_at>=to_timestamp($2::double precision/1000)", [this.hash(address.data), z.number().int().parse(flow.rows[0].data.context.startedAt ?? flow.rows[0].data.initiatedAt)]);
   if (suppressed.rowCount) return null;
   await client.query("DELETE FROM login_mail_budget WHERE window_start<clock_timestamp()-interval '2 days'");
   await client.query("DELETE FROM login_suppression WHERE expires_at<=clock_timestamp()");
   const buckets = [{ key: "daily", period: "day", limit: 80 }, { key: "address:" + this.hash(address.data), period: "hour", limit: 3 }];
   for (const bucket of buckets) {
    const usage = await client.query("SELECT used FROM login_mail_budget WHERE bucket=$1 AND window_start=date_trunc($2,clock_timestamp())", [bucket.key, bucket.period]);
    if (Number(usage.rows[0]?.used ?? 0) >= bucket.limit) return null;
   }
   for (const bucket of buckets) await client.query("INSERT INTO login_mail_budget(bucket,window_start,used) VALUES($1,date_trunc($2,clock_timestamp()),1) ON CONFLICT(bucket,window_start) DO UPDATE SET used=login_mail_budget.used+1", [bucket.key, bucket.period]);
   await client.query("INSERT INTO login_addresses(address_digest,subject,email) VALUES($1,$2,$3) ON CONFLICT(address_digest) DO NOTHING", [this.hash(address.data), randomUUID(), address.data]);
   const identity = identitySchema.parse((await client.query("SELECT subject,email FROM login_addresses WHERE address_digest=$1", [this.hash(address.data)])).rows[0]);
   const key = randomUUID();
   await client.query("INSERT INTO login_challenges(state,subject,browser,purpose,code_digest,expires_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '10 minutes') ON CONFLICT(state) DO UPDATE SET subject=excluded.subject,code_digest=excluded.code_digest,attempts=0,accepted=false,expires_at=excluded.expires_at", [state, identity.subject, browser, purpose, this.hash(JSON.stringify([state, browser, purpose, code]))]);
   return { key, digest: this.hash(JSON.stringify([state, browser, purpose, code])) };
  });
  if (!reservation) return false;
  const submission = await this.delivery.submit({ from: this.from, subject: "Your Scoat sign-in code", text: "Your Scoat code is " + code + ". It expires in 10 minutes.", html: "<p>Your Scoat code is <strong>" + code + "</strong>. It expires in 10 minutes.</p>", headers: {} }, address.data, "login-" + reservation.key, AbortSignal.timeout(submitLimitMilliseconds));
  if (submission.kind !== "accepted") return false;
  return retryTransaction(this.pool, async client => Boolean((await client.query("UPDATE login_challenges SET accepted=true WHERE state=$1 AND code_digest=$2 AND expires_at>clock_timestamp() RETURNING state", [state, reservation.digest])).rowCount));
 }
 async consume(state: string, browser: string, purpose: string, code: string) {
  return retryTransaction(this.pool, async client => {
   await client.query("SELECT pg_advisory_xact_lock(80110)");
   const row = (await client.query("UPDATE login_challenges SET attempts=attempts+1 WHERE state=$1 AND browser=$2 AND purpose=$3 AND accepted AND attempts<5 AND expires_at>clock_timestamp() RETURNING subject,code_digest", [state, browser, purpose])).rows[0];
   if (!row || !timingSafeEqual(Buffer.from(row.code_digest, "hex"), Buffer.from(this.hash(JSON.stringify([state, browser, purpose, code])), "hex"))) return null;
   const identity = (await client.query("SELECT subject,email FROM login_addresses WHERE subject=$1", [row.subject])).rows[0];
   await client.query("DELETE FROM login_challenges WHERE state=$1", [state]);
   return identitySchema.parse(identity);
  });
 }
 async session(secret: string | undefined, issuer: string) {
  if (!secret) return null;
  const row = (await this.pool.query("SELECT a.subject,a.email FROM login_sessions s JOIN login_addresses a USING(subject) JOIN oauth_identities i ON i.subject=a.subject::text JOIN hunt_accounts h ON h.account=i.account AND h.incarnation=i.incarnation WHERE s.digest=$1 AND i.issuer=$2 AND NOT h.erased AND s.expires_at>clock_timestamp()", [this.hash(secret), issuer])).rows[0];
  return row ? identitySchema.parse(row) : null;
 }
 async establish(subject: string): Promise<string> {
  const secret = randomBytes(32).toString("base64url");
  await retryTransaction(this.pool, client => client.query("INSERT INTO login_sessions(digest,subject,expires_at) VALUES($1,$2,clock_timestamp()+interval '30 days')", [this.hash(secret), subject]));
  return secret;
 }
}

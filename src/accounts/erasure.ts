import { SerializationConflict } from "../db/transaction.js";
import { deleteMemory } from "../memory/storage.js";
import { deleteHunts } from "../hunt/postgres.js";
import { deleteAuthentication } from "../auth/erasure.js";
import { createHmac } from "node:crypto";
import type pg from "pg";
import type { AccountScope } from "../domain.js";

export async function eraseAccount(client: pg.PoolClient, scope: AccountScope, lifecycleKey: string, keyVersion: string, statusDigest: string) {
 const prefix = [scope.account,scope.incarnation];
 const candidates = await client.query<{issuer:string;subject:string}>("SELECT issuer,subject FROM oauth_identities WHERE account=$1 AND incarnation=$2 ORDER BY issuer,subject",prefix);
 const lockedSubjects = new Set(candidates.rows.map(identity => JSON.stringify([identity.issuer,identity.subject])));
 for (const subject of lockedSubjects) await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[subject]);
 const active = await client.query("SELECT 1 FROM hunt_accounts WHERE account=$1 AND incarnation=$2 AND NOT erased FOR UPDATE", prefix);
 if (!active.rowCount) throw new Error("Inactive account incarnation");
 const status = await client.query("SELECT 1 FROM erase_status WHERE digest=$1 AND completed_at IS NULL AND expires_at>now() FOR UPDATE", [statusDigest]);
 if (!status.rowCount) throw new Error("Completion capability unavailable");
 const identities = await client.query<{ issuer: string; subject: string }>("SELECT issuer,subject FROM oauth_identities WHERE account=$1 AND incarnation=$2", prefix);
 if (identities.rows.some(identity => !lockedSubjects.has(JSON.stringify([identity.issuer,identity.subject])))) throw new SerializationConflict("Identity inventory changed");
 for (const identity of identities.rows) {
  const pseudonym = createHmac("sha256",lifecycleKey).update(JSON.stringify([identity.issuer,identity.subject])).digest("hex");
  await client.query("INSERT INTO account_suppression(account,incarnation,subject_digest,key_version) VALUES($1,$2,$3,$4)", [...prefix,pseudonym,keyVersion]);
 }
 const authentication = await deleteAuthentication(client,scope,identities.rows);
 const memory = await deleteMemory(client,scope);
 const hunts = await deleteHunts(client,scope);
 const counts = { ...authentication,...memory,...hunts };
 await client.query("UPDATE hunt_accounts SET erased=true,erased_at=now() WHERE account=$1 AND incarnation=$2",prefix);
 await client.query("UPDATE erase_status SET completed_at=now(),expires_at=now()+interval '24 hours' WHERE digest=$1", [statusDigest]);
 return { kind: "erased", counts, retention: { policy: "p06-v1", suppressionDays: 31, completionHours: 24, backupMaximumDays: 30, backupEnforcement: "UNTESTED operational gate", providerDeletion: "Upstream identity is retained by its provider", deliveredEmail: "Previously delivered or provider-accepted mail cannot be recalled", hostCopies: "Host transcripts and exported copies remain outside local erasure", lifecycleKey: "Persisted deployment key; rotation and restore require current suppression ledger", jobs: 0 } };
}

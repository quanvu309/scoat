export const lifecycleSchema = `
ALTER TABLE hunt_accounts ADD COLUMN IF NOT EXISTS erased_at timestamptz;
CREATE INDEX IF NOT EXISTS oauth_artifact_expiry ON oauth_artifacts(expires_at);
CREATE INDEX IF NOT EXISTS oauth_flow_expiry ON oauth_browser_flows(expires_at);
CREATE TABLE IF NOT EXISTS account_suppression (
 account text NOT NULL, incarnation uuid NOT NULL, subject_digest text NOT NULL, key_version text NOT NULL,
 erased_at timestamptz NOT NULL DEFAULT now(), purge_after timestamptz NOT NULL DEFAULT now()+interval '31 days',
 PRIMARY KEY(account,incarnation,subject_digest)
);
CREATE INDEX IF NOT EXISTS suppression_expiry ON account_suppression(purge_after);
CREATE TABLE IF NOT EXISTS erase_status (
 digest text PRIMARY KEY, operation uuid NOT NULL, completed_at timestamptz, policy text NOT NULL DEFAULT 'p06-v1',
 expires_at timestamptz NOT NULL DEFAULT now()+interval '5 minutes'
);
CREATE INDEX IF NOT EXISTS erase_status_expiry ON erase_status(expires_at);
CREATE TABLE IF NOT EXISTS scoat_lifecycle_migrations (version text PRIMARY KEY);
DO $migration$
BEGIN
 PERFORM pg_advisory_xact_lock(80106);
 IF NOT EXISTS (SELECT 1 FROM scoat_lifecycle_migrations WHERE version='p06-owner-inventory') THEN
  UPDATE hunt_accounts SET erased_at=now() WHERE erased AND erased_at IS NULL;
  DELETE FROM oauth_artifacts;
  DELETE FROM oauth_browser_flows;
  UPDATE durable_hunts SET data=jsonb_set(data,'{profileProvenance}','{"kind":"explicit"}'::jsonb) WHERE NOT data ? 'profileProvenance';
  INSERT INTO scoat_lifecycle_migrations VALUES('p06-owner-inventory') ON CONFLICT DO NOTHING;
 END IF;
END
$migration$;
`;

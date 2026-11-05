
CREATE TABLE IF NOT EXISTS oauth_artifacts (
  model text NOT NULL,
  id text NOT NULL,
  payload jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY(model,id)
);
CREATE TABLE IF NOT EXISTS oauth_artifact_owners (
 model text NOT NULL, id text NOT NULL, account text NOT NULL,
 PRIMARY KEY(model,id,account), FOREIGN KEY(model,id) REFERENCES oauth_artifacts ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS oauth_owner_accounts ON oauth_artifact_owners(account);
CREATE INDEX IF NOT EXISTS oauth_grants ON oauth_artifacts ((payload->>'grantId'));
CREATE INDEX IF NOT EXISTS oauth_uids ON oauth_artifacts(model,(payload->>'uid'));
CREATE TABLE IF NOT EXISTS oauth_identities (
  issuer text NOT NULL,
  subject text NOT NULL,
  account text NOT NULL,
  incarnation uuid NOT NULL,
  PRIMARY KEY(issuer,subject),
  FOREIGN KEY(account,incarnation) REFERENCES hunt_accounts ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS oauth_browser_flows (
  state text PRIMARY KEY,
  data jsonb NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_browser_flow_owners (
 state text NOT NULL REFERENCES oauth_browser_flows ON DELETE CASCADE, account text NOT NULL, PRIMARY KEY(state,account)
);
CREATE INDEX IF NOT EXISTS oauth_flow_accounts ON oauth_browser_flow_owners(account);
CREATE TABLE IF NOT EXISTS oauth_read_grants (
  digest text PRIMARY KEY,
  account text NOT NULL,
  incarnation uuid NOT NULL,
  hunt text NOT NULL,
  session text NOT NULL,
  permission text NOT NULL CHECK(permission='read'),
  expires_at timestamptz NOT NULL,
  revoked boolean NOT NULL DEFAULT false,
  FOREIGN KEY(account,incarnation,hunt) REFERENCES durable_hunts ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS memory_profiles (
 account text NOT NULL, incarnation uuid NOT NULL, revision uuid NOT NULL, value jsonb NOT NULL,
 PRIMARY KEY(account,incarnation), FOREIGN KEY(account,incarnation) REFERENCES hunt_accounts
);
CREATE TABLE IF NOT EXISTS memory_items (
 account text NOT NULL, incarnation uuid NOT NULL, id uuid NOT NULL, hunt text NOT NULL,
 snapshot jsonb NOT NULL, release jsonb NOT NULL, digest text NOT NULL, format integer NOT NULL DEFAULT 1,
 saved_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(account,incarnation,id), UNIQUE(account,incarnation,hunt),
 FOREIGN KEY(account,incarnation) REFERENCES hunt_accounts
);
CREATE TABLE IF NOT EXISTS memory_commands (
 account text NOT NULL, incarnation uuid NOT NULL, key text NOT NULL, digest text NOT NULL,
 client text NOT NULL, session text NOT NULL, command jsonb, approved boolean NOT NULL DEFAULT false,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '5 minutes', replay_until timestamptz NOT NULL DEFAULT now()+interval '1 hour',
 outcome jsonb, PRIMARY KEY(account,incarnation,key), FOREIGN KEY(account,incarnation) REFERENCES hunt_accounts
);
CREATE INDEX IF NOT EXISTS memory_command_expiry ON memory_commands(expires_at) WHERE command IS NOT NULL;

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

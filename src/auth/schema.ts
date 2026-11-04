export const authSchema = `
CREATE TABLE IF NOT EXISTS oauth_artifacts (
  model text NOT NULL,
  id text NOT NULL,
  payload jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY(model,id)
);
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
`;

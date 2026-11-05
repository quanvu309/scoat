
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

export const memorySchema = `
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
`;

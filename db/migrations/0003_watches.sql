CREATE TABLE IF NOT EXISTS watch_recipients (
 account text NOT NULL, incarnation uuid NOT NULL, revision uuid NOT NULL, address text NOT NULL,
 verified_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(account,incarnation), FOREIGN KEY(account,incarnation) REFERENCES hunt_accounts
);
CREATE TABLE IF NOT EXISTS watches (
 account text NOT NULL, incarnation uuid NOT NULL, id uuid NOT NULL, hunt text NOT NULL, target jsonb NOT NULL,
 basis jsonb NOT NULL, basis_digest text NOT NULL, baseline_pence integer NOT NULL CHECK (baseline_pence>0),
 baseline_observed_at timestamptz NOT NULL, target_pence integer NOT NULL CHECK (target_pence>0),
 recipient_revision uuid NOT NULL, key_version text NOT NULL,
 status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled','expired')),
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now()+interval '90 days', ended_at timestamptz,
 PRIMARY KEY(account,incarnation,id), FOREIGN KEY(account,incarnation) REFERENCES hunt_accounts
);
CREATE UNIQUE INDEX IF NOT EXISTS watch_active_hunt ON watches(account,incarnation,hunt) WHERE status='active';
CREATE INDEX IF NOT EXISTS watch_due ON watches(status,expires_at);
CREATE TABLE IF NOT EXISTS watch_observations (
 account text NOT NULL, incarnation uuid NOT NULL, watch uuid NOT NULL, day date NOT NULL,
 observation jsonb NOT NULL, observed_at timestamptz NOT NULL DEFAULT clock_timestamp(), alert uuid,
 PRIMARY KEY(account,incarnation,watch,day), FOREIGN KEY(account,incarnation,watch) REFERENCES watches ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS watch_alerts (
 account text NOT NULL, incarnation uuid NOT NULL, id uuid NOT NULL, watch uuid NOT NULL, day date NOT NULL,
 amount_pence integer NOT NULL, message jsonb NOT NULL, provider_key text NOT NULL, recipient_revision uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), deadline timestamptz NOT NULL DEFAULT clock_timestamp()+interval '20 hours',
 state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','submitting','accepted','rejected','cancelled','unconfirmed')),
 marked_at timestamptz, attempts integer NOT NULL DEFAULT 0, provider_id text, outcome_at timestamptz, last_error text,
 PRIMARY KEY(account,incarnation,id), UNIQUE(account,incarnation,watch,day), UNIQUE(provider_key),
 FOREIGN KEY(account,incarnation,watch) REFERENCES watches ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS watch_alert_open ON watch_alerts(state,deadline) WHERE state IN ('pending','submitting');

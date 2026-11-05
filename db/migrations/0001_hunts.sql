CREATE TABLE IF NOT EXISTS hunt_accounts (
  account text NOT NULL,
  incarnation uuid NOT NULL,
  erased boolean NOT NULL DEFAULT false,
  PRIMARY KEY (account, incarnation)
);
CREATE TABLE IF NOT EXISTS durable_hunts (
  account text NOT NULL,
  incarnation uuid NOT NULL,
  id text NOT NULL,
  data jsonb NOT NULL,
  release jsonb NOT NULL,
  snapshot jsonb,
  PRIMARY KEY (account, incarnation, id),
  FOREIGN KEY (account, incarnation) REFERENCES hunt_accounts ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS hunt_rows (
  account text NOT NULL,
  incarnation uuid NOT NULL,
  hunt text NOT NULL,
  id text NOT NULL,
  data jsonb NOT NULL,
  PRIMARY KEY (account, incarnation, hunt, id),
  FOREIGN KEY (account, incarnation, hunt) REFERENCES durable_hunts ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS hunt_offers (
  account text NOT NULL,
  incarnation uuid NOT NULL,
  hunt text NOT NULL,
  row_id text NOT NULL,
  slot integer NOT NULL,
  id text NOT NULL,
  data jsonb NOT NULL,
  PRIMARY KEY (account, incarnation, hunt, id),
  FOREIGN KEY (account, incarnation, hunt, row_id) REFERENCES hunt_rows ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS hunt_compatibility (
  account text NOT NULL,
  incarnation uuid NOT NULL,
  hunt text NOT NULL,
  id uuid NOT NULL,
  data jsonb NOT NULL,
  PRIMARY KEY (account, incarnation, hunt, id),
  FOREIGN KEY (account, incarnation, hunt) REFERENCES durable_hunts ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS hunt_compatibility_members (
  account text NOT NULL,
  incarnation uuid NOT NULL,
  hunt text NOT NULL,
  compatibility uuid NOT NULL,
  offer text NOT NULL,
  PRIMARY KEY (account, incarnation, hunt, compatibility, offer),
  FOREIGN KEY (account, incarnation, hunt, compatibility) REFERENCES hunt_compatibility ON DELETE CASCADE,
  FOREIGN KEY (account, incarnation, hunt, offer) REFERENCES hunt_offers ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS hunt_receipts (
  account text NOT NULL,
  incarnation uuid NOT NULL,
  key text NOT NULL,
  digest text NOT NULL,
  reply text,
  PRIMARY KEY (account, incarnation, key),
  FOREIGN KEY (account, incarnation) REFERENCES hunt_accounts ON DELETE RESTRICT
);

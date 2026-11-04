CREATE TABLE IF NOT EXISTS scoat_fixture_lanes (
  lane text PRIMARY KEY,
  market text NOT NULL CHECK (market = 'GB'),
  currency text NOT NULL CHECK (currency = 'GBP')
);

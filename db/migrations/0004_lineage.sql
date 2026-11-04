CREATE TABLE IF NOT EXISTS scoat_lineage (
 singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
 state text NOT NULL CHECK (state IN ('admitted','sealed')),
 seal_id uuid,
 consumed_by text,
 identity text NOT NULL,
 schema_head text NOT NULL,
 changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK ((state = 'sealed') = (seal_id IS NOT NULL)),
 CHECK (state = 'sealed' OR consumed_by IS NULL)
);
CREATE OR REPLACE FUNCTION scoat_lineage_identity(row_xmin numeric) RETURNS text LANGUAGE sql VOLATILE AS $lineage$
SELECT concat_ws(':', (pg_control_system()).system_identifier, ('x' || substr(pg_walfile_name(pg_current_wal_lsn()), 1, 8))::bit(32)::bigint, (SELECT oid FROM pg_database WHERE datname = current_database()), to_regclass(quote_ident(current_schema()) || '.scoat_lineage')::oid, row_xmin)
$lineage$;
CREATE OR REPLACE FUNCTION scoat_lineage_pristine() RETURNS boolean LANGUAGE plpgsql STABLE AS $lineage$
DECLARE
 relation text;
 populated boolean;
BEGIN
 FOR relation IN SELECT c.relname FROM pg_class c WHERE c.relnamespace = (SELECT n.oid FROM pg_namespace n WHERE n.nspname = current_schema()) AND c.relkind IN ('r', 'p') AND c.relname NOT IN ('scoat_lineage', 'scoat_lifecycle_migrations', 'scoat_fixture_lanes') LOOP
  EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I.%I)', current_schema(), relation) INTO populated;
  IF populated THEN
   RETURN false;
  END IF;
 END LOOP;
 RETURN true;
END
$lineage$;
INSERT INTO scoat_lineage (state, identity, schema_head) SELECT 'admitted', scoat_lineage_identity(pg_current_xact_id()::text::numeric % 4294967296), '0004_lineage' WHERE NOT EXISTS (SELECT 1 FROM scoat_lineage) AND scoat_lineage_pristine();

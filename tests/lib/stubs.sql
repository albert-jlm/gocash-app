-- ===========================================================================
-- Stubs — the parts of a Supabase database that supabase/migrations/ assumes
-- already exist, but that no migration in this repo creates.
--
-- WHY THIS FILE EXISTS
-- The baseline migration is a pg_dump of a live Supabase instance, so it
-- references auth.users, auth.uid() and the extensions schema without ever
-- creating them. Applied to a bare database it fails on the first FK. These
-- four statements are the minimum that lets the five migrations replay in
-- order, and they are deliberately minimal: the point of the harness is to
-- test what the migrations produce, not to reproduce Supabase.
--
-- auth.uid() returns NULL on purpose. Every RLS policy in gocash resolves
-- through it, so with no session it evaluates to "owns nothing" — which is
-- the correct posture for an unauthenticated caller and keeps the layer 1
-- privilege assertions honest. Layer 1 tests GRANTs (who may call what at
-- all), not policy row-filtering, so it needs no signed-in identity.
-- ===========================================================================

-- Incidental NOTICEs (the event trigger announcing each auto-revoke, DROP ...
-- IF EXISTS on a fresh database) would bury the assertion output. Real
-- problems are WARNING or above and still come through.
SET client_min_messages = warning;

CREATE SCHEMA auth;
CREATE SCHEMA extensions;

-- gocash.audit_logs / transactions / transaction_rules default their ids to
-- extensions.uuid_generate_v4().
CREATE EXTENSION "uuid-ossp" SCHEMA extensions;

-- gocash.operators.user_id has an FK to this.
CREATE TABLE auth.users (
  id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text
);

CREATE FUNCTION auth.uid() RETURNS uuid
  LANGUAGE sql STABLE
  AS $f$ SELECT NULL::uuid $f$;

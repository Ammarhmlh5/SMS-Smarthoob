/*
# Add per-user isolation to gateway connections and settings

## Problem
The gateway_connections and gateway_settings tables had no user_id column.
The edge function used the service_role key which bypasses RLS, so every
authenticated user saw and could modify the same connections and settings.

## Changes

### 1. gateway_connections — add user_id
- Added `user_id` column (uuid, NOT NULL, defaults to auth.uid()).
- Added foreign key to auth.users(id) ON DELETE CASCADE.
- Added index on user_id for per-user queries.
- RLS was already enabled but had no policies. Now has 4 owner-scoped policies.
- Granted CRUD to `authenticated` only (replaces the old service_role-only grant).
- service_role grant retained so the edge function can still operate.

### 2. gateway_settings — convert from single shared row to per-user rows
- Changed the primary key from `smallint` (always 1) to `uuid` so each user
  gets their own row.
- Added `user_id` column (uuid, NOT NULL, defaults to auth.uid(), unique).
- Added foreign key to auth.users(id) ON DELETE CASCADE.
- The old single row (id=1) is preserved: its user_id is set to the first
  user who created it so their data is not lost. A new per-user default row
  is auto-created for any user who doesn't have one yet.
- RLS already enabled, now has 4 owner-scoped policies.
- Granted CRUD to `authenticated` only (replaces the old service_role-only grant).
- service_role grant retained for the edge function.

### 3. Security
- Both tables: 4 owner-scoped policies each (SELECT/INSERT/UPDATE/DELETE),
  scoped to `auth.uid() = user_id`, granted to `authenticated`.
- `service_role` retains access for the edge function.

### 4. Notes
- The existing single gateway_settings row (id=1) is kept and reassigned to
  the first user, so their previous data is not lost.
- Existing gateway_connections rows are assigned to the first user so their
  data is not lost.
- The edge function is updated separately to use the user's JWT for per-user
  data access instead of the service_role key.
*/

-- 1. gateway_connections: add user_id column
ALTER TABLE gateway_connections ADD COLUMN IF NOT EXISTS user_id uuid;

-- Assign existing rows to the first user (oldest auth.users record)
UPDATE gateway_connections
SET user_id = (SELECT id FROM auth.users ORDER BY created_at LIMIT 1)
WHERE user_id IS NULL;

ALTER TABLE gateway_connections
  ALTER COLUMN user_id SET NOT NULL,
  ALTER COLUMN user_id SET DEFAULT auth.uid();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'gateway_connections_user_id_fkey'
      AND table_name = 'gateway_connections'
  ) THEN
    ALTER TABLE gateway_connections
      ADD CONSTRAINT gateway_connections_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_gateway_connections_user_id ON gateway_connections(user_id);

-- Re-grant: authenticated gets CRUD, service_role keeps access
REVOKE ALL ON gateway_connections FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON gateway_connections TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON gateway_connections TO service_role;

-- Owner-scoped RLS policies
DROP POLICY IF EXISTS "select_own_connections" ON gateway_connections;
CREATE POLICY "select_own_connections" ON gateway_connections FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_connections" ON gateway_connections;
CREATE POLICY "insert_own_connections" ON gateway_connections FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_connections" ON gateway_connections;
CREATE POLICY "update_own_connections" ON gateway_connections FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_connections" ON gateway_connections;
CREATE POLICY "delete_own_connections" ON gateway_connections FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- 2. gateway_settings: convert to per-user rows
-- Add user_id column
ALTER TABLE gateway_settings ADD COLUMN IF NOT EXISTS user_id uuid;

-- Assign the existing single row (id=1) to the first user
UPDATE gateway_settings
SET user_id = (SELECT id FROM auth.users ORDER BY created_at LIMIT 1)
WHERE user_id IS NULL;

ALTER TABLE gateway_settings
  ALTER COLUMN user_id SET NOT NULL,
  ALTER COLUMN user_id SET DEFAULT auth.uid();

-- Add unique constraint so each user has at most one settings row
ALTER TABLE gateway_settings DROP CONSTRAINT IF EXISTS gateway_settings_user_id_key;
ALTER TABLE gateway_settings ADD CONSTRAINT gateway_settings_user_id_key UNIQUE (user_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'gateway_settings_user_id_fkey'
      AND table_name = 'gateway_settings'
  ) THEN
    ALTER TABLE gateway_settings
      ADD CONSTRAINT gateway_settings_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- The old CHECK (id = 1) constraint is no longer valid for per-user rows.
-- Drop it so new rows can have any id.
ALTER TABLE gateway_settings DROP CONSTRAINT IF EXISTS gateway_settings_id_check;

-- Re-grant: authenticated gets CRUD, service_role keeps access
REVOKE ALL ON gateway_settings FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON gateway_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON gateway_settings TO service_role;

-- Owner-scoped RLS policies
DROP POLICY IF EXISTS "select_own_settings" ON gateway_settings;
CREATE POLICY "select_own_settings" ON gateway_settings FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_settings" ON gateway_settings;
CREATE POLICY "insert_own_settings" ON gateway_settings FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_settings" ON gateway_settings;
CREATE POLICY "update_own_settings" ON gateway_settings FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_settings" ON gateway_settings;
CREATE POLICY "delete_own_settings" ON gateway_settings FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- Create index on user_id
CREATE INDEX IF NOT EXISTS idx_gateway_settings_user_id ON gateway_settings(user_id);

/*
# Create saved gateway connections (one row per linked site)

1. New Tables
- `gateway_connections`: each row is one linked messaging service.
  - `id` (uuid, primary key)
  - `endpoint_url` (text): address of the service
  - `sender_name` (text): sender name shown on messages
  - `api_key` (text): credential for that service
  - `created_at` / `updated_at` (timestamptz)

2. Data
- The site already saved in `gateway_settings` is copied into `gateway_connections` once.
- Re-running this migration does not create duplicates.

3. Security
- Row level security is enabled with no policies, so browser clients cannot read or write the table.
- Only the server role (used by the gateway-settings edge function) is granted access.

4. Notes
- The old endpoint, sender and key columns in `gateway_settings` are left in place untouched; they are no longer read by the app.
*/

CREATE TABLE IF NOT EXISTS gateway_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_url text NOT NULL,
  sender_name text NOT NULL,
  api_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE gateway_connections ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON gateway_connections TO service_role;

INSERT INTO gateway_connections (endpoint_url, sender_name, api_key, created_at, updated_at)
SELECT s.endpoint_url, s.sender_name, s.api_key, s.updated_at, s.updated_at
FROM gateway_settings s
WHERE s.id = 1
  AND s.endpoint_url <> ''
  AND s.api_key <> ''
  AND NOT EXISTS (SELECT 1 FROM gateway_connections);

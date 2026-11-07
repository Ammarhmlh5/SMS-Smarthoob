/*
# Create gateway settings (single row, server-only access)

1. New Tables
- `gateway_settings`: one row holding how the app connects to the SMS gateway.
  - `id` (smallint, always 1, enforces a single row)
  - `endpoint_url` (text): address the app sends messages to
  - `sender_name` (text): sender name shown on SMS messages
  - `api_key` (text): gateway credential
  - `updated_at` (timestamptz)

2. Security
- Row level security is enabled with no policies, so browser clients cannot read or write the table directly.
- Only the server role (used by the gateway-settings edge function) is granted access, so the API key is never exposed to the app.

3. Notes
- A default row is inserted with empty values so the settings screen always has a record to update.
*/

CREATE TABLE IF NOT EXISTS gateway_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  endpoint_url text NOT NULL DEFAULT '',
  sender_name text NOT NULL DEFAULT '',
  api_key text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE gateway_settings ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON gateway_settings TO service_role;

INSERT INTO gateway_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

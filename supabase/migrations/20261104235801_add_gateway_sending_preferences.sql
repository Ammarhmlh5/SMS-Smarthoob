/*
# Add sending preferences to gateway settings

1. Modified Tables
- `gateway_settings`
  - `batch_size` (smallint, default 50, between 10 and 100): number of messages sent per batch
  - `max_retries` (smallint, default 3, between 0 and 5): retry attempts after a failed send

2. Security
- No change to access. The table stays closed to browser clients and is reached only through the server function.

3. Notes
- Existing rows receive the defaults, so no stored data is changed.
*/

ALTER TABLE gateway_settings ADD COLUMN IF NOT EXISTS batch_size smallint NOT NULL DEFAULT 50;
ALTER TABLE gateway_settings ADD COLUMN IF NOT EXISTS max_retries smallint NOT NULL DEFAULT 3;

ALTER TABLE gateway_settings DROP CONSTRAINT IF EXISTS gateway_settings_batch_size_check;
ALTER TABLE gateway_settings ADD CONSTRAINT gateway_settings_batch_size_check CHECK (batch_size BETWEEN 10 AND 100);

ALTER TABLE gateway_settings DROP CONSTRAINT IF EXISTS gateway_settings_max_retries_check;
ALTER TABLE gateway_settings ADD CONSTRAINT gateway_settings_max_retries_check CHECK (max_retries BETWEEN 0 AND 5);

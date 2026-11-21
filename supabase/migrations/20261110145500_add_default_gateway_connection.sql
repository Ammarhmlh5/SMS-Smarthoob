ALTER TABLE gateway_settings
  ADD COLUMN IF NOT EXISTS default_connection_id uuid
  REFERENCES gateway_connections(id) ON DELETE SET NULL;

UPDATE gateway_settings AS settings
SET default_connection_id = (
  SELECT connection.id
  FROM gateway_connections AS connection
  WHERE connection.user_id = settings.user_id
  ORDER BY connection.created_at, connection.id
  LIMIT 1
)
WHERE settings.default_connection_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_gateway_settings_default_connection_id
  ON gateway_settings(default_connection_id);

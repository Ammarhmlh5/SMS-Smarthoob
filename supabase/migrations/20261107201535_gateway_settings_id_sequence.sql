CREATE SEQUENCE IF NOT EXISTS gateway_settings_id_seq;
SELECT setval('gateway_settings_id_seq', GREATEST((SELECT COALESCE(MAX(id), 0) FROM gateway_settings), 1));
ALTER TABLE gateway_settings ALTER COLUMN id SET DEFAULT nextval('gateway_settings_id_seq');
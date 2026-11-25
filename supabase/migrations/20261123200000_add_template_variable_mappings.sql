ALTER TABLE message_templates
  ADD COLUMN IF NOT EXISTS variable_mappings jsonb NOT NULL DEFAULT '{}'::jsonb;

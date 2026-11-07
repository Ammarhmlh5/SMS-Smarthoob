/*
# Create message templates table

1. New Tables
- `message_templates`: stores reusable SMS message templates per user.
  - `id` (uuid, primary key)
  - `title` (text, not null): a short name for the template
  - `body` (text, not null): the message content, may contain placeholders like {{name}} or {{amount}}
  - `user_id` (uuid, not null, defaults to auth.uid()): owner of the template
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

2. Security
- Row level security is enabled.
- Grant SELECT, INSERT, UPDATE, DELETE to `authenticated` only (app requires sign-in).
- Four owner-scoped policies (one per CRUD verb) using auth.uid() = user_id.

3. Notes
- The `user_id` column defaults to auth.uid() so inserts that omit it still satisfy the INSERT policy.
- Each user sees and manages only their own templates.
*/

CREATE TABLE IF NOT EXISTS message_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (length(trim(title)) >= 1 AND length(trim(title)) <= 100),
  body text NOT NULL CHECK (length(trim(body)) >= 1 AND length(body) <= 1000),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON message_templates TO authenticated;

DROP POLICY IF EXISTS "select_own_templates" ON message_templates;
CREATE POLICY "select_own_templates" ON message_templates FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_templates" ON message_templates;
CREATE POLICY "insert_own_templates" ON message_templates FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_templates" ON message_templates;
CREATE POLICY "update_own_templates" ON message_templates FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_templates" ON message_templates;
CREATE POLICY "delete_own_templates" ON message_templates FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_message_templates_user_id ON message_templates(user_id);

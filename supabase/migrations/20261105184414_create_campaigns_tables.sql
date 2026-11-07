/*
# Create campaigns and campaign_recipients tables

1. New Tables
- `campaigns`: each row is a bulk sending job.
  - `id` (uuid, primary key)
  - `name` (text): a label for the campaign
  - `template_id` (uuid, FK to message_templates, nullable): which template was used
  - `connection_id` (uuid, FK to gateway_connections, nullable): which gateway connection was used
  - `status` (text): one of 'draft', 'sending', 'completed', 'failed'
  - `total_recipients` (int, default 0): how many recipients
  - `sent_count` (int, default 0): how many sent successfully
  - `failed_count` (int, default 0): how many failed
  - `user_id` (uuid, defaults to auth.uid()): owner
  - `created_at` / `updated_at` (timestamptz)

- `campaign_recipients`: individual recipients within a campaign.
  - `id` (uuid, primary key)
  - `campaign_id` (uuid, FK to campaigns ON DELETE CASCADE)
  - `subscriber_email` (text): email/phone from the source platform
  - `subscriber_name` (text, nullable): name from the source platform
  - `status` (text): one of 'pending', 'sent', 'failed'
  - `error_message` (text, nullable): failure reason
  - `sent_at` (timestamptz, nullable)
  - `created_at` (timestamptz)

2. Security
- Both tables: RLS enabled, owner-scoped policies on user_id (campaigns) or via campaign ownership (recipients).
- Grants to authenticated only.
- service_role granted for edge function access.

3. Notes
- campaign_recipients has no direct user_id; its policies check ownership through the parent campaign.
- The edge function uses the user's JWT so RLS enforces isolation automatically.
*/

CREATE TABLE IF NOT EXISTS campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) >= 1 AND length(trim(name)) <= 200),
  template_id uuid REFERENCES message_templates(id) ON DELETE SET NULL,
  connection_id uuid REFERENCES gateway_connections(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sending', 'completed', 'failed')),
  total_recipients int NOT NULL DEFAULT 0,
  sent_count int NOT NULL DEFAULT 0,
  failed_count int NOT NULL DEFAULT 0,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON campaigns TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON campaigns TO service_role;

DROP POLICY IF EXISTS "select_own_campaigns" ON campaigns;
CREATE POLICY "select_own_campaigns" ON campaigns FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_campaigns" ON campaigns;
CREATE POLICY "insert_own_campaigns" ON campaigns FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_campaigns" ON campaigns;
CREATE POLICY "update_own_campaigns" ON campaigns FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_campaigns" ON campaigns;
CREATE POLICY "delete_own_campaigns" ON campaigns FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_campaigns_user_id ON campaigns(user_id);

CREATE TABLE IF NOT EXISTS campaign_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  subscriber_email text NOT NULL,
  subscriber_name text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  error_message text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE campaign_recipients ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON campaign_recipients TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON campaign_recipients TO service_role;

DROP POLICY IF EXISTS "select_own_recipients" ON campaign_recipients;
CREATE POLICY "select_own_recipients" ON campaign_recipients FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM campaigns WHERE campaigns.id = campaign_recipients.campaign_id AND campaigns.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "insert_own_recipients" ON campaign_recipients;
CREATE POLICY "insert_own_recipients" ON campaign_recipients FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM campaigns WHERE campaigns.id = campaign_recipients.campaign_id AND campaigns.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "update_own_recipients" ON campaign_recipients;
CREATE POLICY "update_own_recipients" ON campaign_recipients FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM campaigns WHERE campaigns.id = campaign_recipients.campaign_id AND campaigns.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM campaigns WHERE campaigns.id = campaign_recipients.campaign_id AND campaigns.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "delete_own_recipients" ON campaign_recipients;
CREATE POLICY "delete_own_recipients" ON campaign_recipients FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM campaigns WHERE campaigns.id = campaign_recipients.campaign_id AND campaigns.user_id = auth.uid())
  );

CREATE INDEX IF NOT EXISTS idx_recipients_campaign_id ON campaign_recipients(campaign_id);

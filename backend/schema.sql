CREATE TABLE IF NOT EXISTS public.gateway_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_url text NOT NULL,
  sender_name text NOT NULL,
  api_key text NOT NULL,
  user_id uuid NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.message_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 100),
  body text NOT NULL CHECK (length(trim(body)) >= 1 AND length(body) <= 1000),
  user_id uuid NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.gateway_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE DEFAULT '00000000-0000-4000-8000-000000000001',
  batch_size smallint NOT NULL DEFAULT 50 CHECK (batch_size BETWEEN 10 AND 100),
  max_retries smallint NOT NULL DEFAULT 3 CHECK (max_retries BETWEEN 0 AND 5),
  default_connection_id uuid REFERENCES public.gateway_connections(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  template_id uuid REFERENCES public.message_templates(id) ON DELETE SET NULL,
  connection_id uuid REFERENCES public.gateway_connections(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'preparing', 'sending', 'completed', 'failed')),
  total_recipients integer NOT NULL DEFAULT 0,
  sent_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  user_id uuid NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.campaign_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  subscriber_email text,
  subscriber_name text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed')),
  error_message text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_local_templates_user ON public.message_templates(user_id);
CREATE INDEX IF NOT EXISTS idx_local_campaigns_user ON public.campaigns(user_id);
CREATE INDEX IF NOT EXISTS idx_local_connections_user ON public.gateway_connections(user_id);

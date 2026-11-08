import { supabase } from '@/lib/supabase';
import { database } from '@/lib/database';

export type MessageTemplate = {
  id: string;
  title: string;
  body: string;
  user_id?: string;
  is_default?: boolean;
  created_at: string;
  updated_at: string;
  sync_status?: 'synced' | 'pending' | 'conflict';
};

export type TemplateInput = {
  title: string;
  body: string;
};

const GENERIC_ERROR = 'تعذر الاتصال بالخادم. حاول مرة أخرى.';

function isTemplate(value: unknown): value is MessageTemplate {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.title === 'string' &&
    typeof v.body === 'string' &&
    typeof v.created_at === 'string' &&
    typeof v.updated_at === 'string'
  );
}

export async function fetchTemplates(userId?: string): Promise<MessageTemplate[]> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    const effectiveUserId = userId || user?.id || 'default';

    // 1. Fetch from local SQLite DB first
    const localTemplates = await database.getTemplates(effectiveUserId);

    // Trigger non-blocking cloud sync if authenticated
    if (user) {
      database.syncWithSupabase().catch((err) => {
        console.warn('Background sync error:', err);
      });
    }

    if (localTemplates.length > 0) {
      return localTemplates;
    }
  } catch (err) {
    console.warn('SQLite fetchTemplates error, falling back to Supabase:', err);
  }

  // 2. Direct Supabase fallback
  try {
    const { data, error } = await supabase
      .from('message_templates')
      .select('id, title, body, created_at, updated_at')
      .order('updated_at', { ascending: false });
    if (!error && data) {
      return (data ?? []).filter(isTemplate);
    }
  } catch {
    // offline or network error
  }

  return [];
}

export async function createTemplate(input: TemplateInput, userId?: string): Promise<MessageTemplate> {
  const { data: { user } } = await supabase.auth.getUser();
  const effectiveUserId = userId || user?.id || 'default';
  const now = new Date().toISOString();
  const id = `tmpl_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  const newTemplate: MessageTemplate = {
    id,
    title: input.title.trim(),
    body: input.body.trim(),
    user_id: effectiveUserId,
    is_default: false,
    created_at: now,
    updated_at: now,
    sync_status: 'pending',
  };

  try {
    await database.createTemplate(newTemplate as any);
    if (user) {
      database.syncWithSupabase().catch(() => {});
    }
    return newTemplate;
  } catch (dbErr) {
    console.warn('Local create failed, trying cloud direct:', dbErr);
    const { data, error } = await supabase
      .from('message_templates')
      .insert({ title: input.title.trim(), body: input.body.trim() })
      .select('id, title, body, created_at, updated_at')
      .single();
    if (error) throw new Error(GENERIC_ERROR);
    if (!isTemplate(data)) throw new Error(GENERIC_ERROR);
    return data;
  }
}

export async function updateTemplate(id: string, input: TemplateInput): Promise<MessageTemplate> {
  const now = new Date().toISOString();
  try {
    await database.updateTemplate(id, {
      title: input.title.trim(),
      body: input.body.trim(),
    });
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      database.syncWithSupabase().catch(() => {});
    }
    const updated = await database.getTemplate(id);
    if (updated) return updated;
  } catch (dbErr) {
    console.warn('Local update failed, trying cloud direct:', dbErr);
  }

  const { data, error } = await supabase
    .from('message_templates')
    .update({ title: input.title.trim(), body: input.body.trim(), updated_at: now })
    .eq('id', id)
    .select('id, title, body, created_at, updated_at')
    .single();
  if (error) throw new Error(GENERIC_ERROR);
  if (!isTemplate(data)) throw new Error(GENERIC_ERROR);
  return data;
}

export async function deleteTemplate(id: string): Promise<void> {
  try {
    await database.deleteTemplate(id);
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      database.syncWithSupabase().catch(() => {});
    }
    return;
  } catch (dbErr) {
    console.warn('Local delete failed, trying cloud direct:', dbErr);
  }

  const { error } = await supabase.from('message_templates').delete().eq('id', id);
  if (error) throw new Error(GENERIC_ERROR);
}

export function extractPlaceholders(body: string): string[] {
  // Support both English and Arabic variables: {{name}} or {{الاسم}}
  const matches = body.matchAll(/\{\{\s*([\w\u0600-\u06FF\u0750-\u077F]+)\s*\}\}/g);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const match of matches) {
    const name = match[1];
    if (!seen.has(name)) {
      seen.add(name);
      result.push(name);
    }
  }
  return result;
}

export function renderMessage(templateBody: string, data: Record<string, string>): string {
  return templateBody.replace(/\{\{\s*([\w\u0600-\u06FF\u0750-\u077F]+)\s*\}\}/g, (_match, key) => {
    return data[key] !== undefined ? data[key] : '';
  });
}

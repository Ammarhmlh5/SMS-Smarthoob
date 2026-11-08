import { supabase } from '@/lib/supabase';

export type MessageTemplate = {
  id: string;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
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

export async function fetchTemplates(): Promise<MessageTemplate[]> {
  const { data, error } = await supabase
    .from('message_templates')
    .select('id, title, body, created_at, updated_at')
    .order('updated_at', { ascending: false });
  if (error) throw new Error(GENERIC_ERROR);
  return (data ?? []).filter(isTemplate);
}

export async function createTemplate(input: TemplateInput): Promise<MessageTemplate> {
  const { data, error } = await supabase
    .from('message_templates')
    .insert({ title: input.title.trim(), body: input.body.trim() })
    .select('id, title, body, created_at, updated_at')
    .single();
  if (error) throw new Error(GENERIC_ERROR);
  if (!isTemplate(data)) throw new Error(GENERIC_ERROR);
  return data;
}

export async function updateTemplate(id: string, input: TemplateInput): Promise<MessageTemplate> {
  const { data, error } = await supabase
    .from('message_templates')
    .update({ title: input.title.trim(), body: input.body.trim(), updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id, title, body, created_at, updated_at')
    .single();
  if (error) throw new Error(GENERIC_ERROR);
  if (!isTemplate(data)) throw new Error(GENERIC_ERROR);
  return data;
}

export async function deleteTemplate(id: string): Promise<void> {
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

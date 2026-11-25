import { supabase } from '@/lib/supabase';
import { database, type MessageTemplate as DatabaseMessageTemplate } from '@/lib/database';
import { createUuid } from '@/lib/ids';
import {
  type TemplateVariableMappings,
} from '@/lib/templateMappings';
import { createTemplateLoadError } from './templateErrors';
import { decodeTemplateRecord } from './templateRecord';
import type { MessageTemplate } from './templateRecord';
export {
  extractPlaceholders,
  getTemplateReadiness,
  hasPlaceholder,
  renderMessage,
  renderTemplatePreview,
} from '@/lib/templateContent';
export type { MessageTemplate } from './templateRecord';

export type TemplateInput = {
  title: string;
  body: string;
  variable_mappings?: TemplateVariableMappings;
};

const GENERIC_ERROR = 'تعذر الاتصال بالخادم. حاول مرة أخرى.';

function syncInBackground(): void {
  void syncTemplates().then((result) => {
    if (!result.success) console.warn('Template background sync failed:', result.message);
  }).catch((error) => {
    console.warn('Template background sync error:', error);
  });
}

export function syncTemplates(): Promise<{ success: boolean; message: string }> {
  return database.syncWithSupabase();
}

export async function fetchTemplates(
  userId?: string,
  options: { sync?: boolean } = {},
): Promise<MessageTemplate[]> {
  const { data: { session }, error: authError } = await supabase.auth.getSession();
  if (authError) throw new Error('تعذر التحقق من الحساب الحالي.', { cause: authError });

  const effectiveUserId = userId || session?.user.id || 'default';
  let localTemplates: DatabaseMessageTemplate[];
  try {
    localTemplates = await database.getTemplates(effectiveUserId);
  } catch (localError) {
    if (!session) {
      throw new Error('تعذر تحميل القوالب من التخزين المحلي.', { cause: localError });
    }
    console.warn('SQLite fetchTemplates error, falling back to Supabase:', localError);
    try {
      return await fetchTemplatesFromCloud(session.user.id);
    } catch (cloudError) {
      throw createTemplateLoadError(localError, cloudError);
    }
  }

  if (localTemplates.length > 0) {
    const templates = localTemplates.map((template) => decodeTemplateRecord(template));
    if (session && options.sync !== false) syncInBackground();
    return templates;
  }

  if (!session) return [];
  if (options.sync !== false) syncInBackground();
  return fetchTemplatesFromCloud(session.user.id);
}

async function fetchTemplatesFromCloud(userId: string): Promise<MessageTemplate[]> {
  const { data, error } = await supabase
    .from('message_templates')
    .select('id, title, body, variable_mappings, user_id, created_at, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  if (error) throw new Error('تعذر تحميل القوالب من الخادم.', { cause: error });
  if (!data) throw new Error('لم يُرجع الخادم بيانات القوالب.');
  return data.map((template) => decodeTemplateRecord(template, 'synced'));
}

export async function createTemplate(input: TemplateInput, userId?: string): Promise<MessageTemplate> {
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw new Error('تعذر التحقق من الحساب الحالي.', { cause: sessionError });
  const effectiveUserId = userId || session?.user.id || 'default';
  const now = new Date().toISOString();
  const id = createUuid();

  const newTemplate: MessageTemplate = {
    id,
    title: input.title.trim(),
    body: input.body.trim(),
    variable_mappings: input.variable_mappings ?? {},
    user_id: effectiveUserId,
    is_default: false,
    created_at: now,
    updated_at: now,
    sync_status: 'pending',
  };

  try {
    const localTemplate: Omit<DatabaseMessageTemplate, 'sync_status'> = {
      id,
      title: newTemplate.title,
      body: newTemplate.body,
      variable_mappings: JSON.stringify(newTemplate.variable_mappings),
      user_id: effectiveUserId,
      is_default: false,
      created_at: now,
      updated_at: now,
    };
    await database.createTemplate(localTemplate);
    if (session) syncInBackground();
    return newTemplate;
  } catch (dbErr) {
    console.warn('Local create failed, trying cloud direct:', dbErr);
    const { data, error } = await supabase
      .from('message_templates')
      .insert({
        title: input.title.trim(),
        body: input.body.trim(),
        variable_mappings: input.variable_mappings ?? {},
      })
      .select('id, title, body, variable_mappings, created_at, updated_at')
      .single();
    if (error) throw new Error(GENERIC_ERROR);
    return decodeTemplateRecord(data, 'synced');
  }
}

export async function updateTemplate(id: string, input: TemplateInput): Promise<MessageTemplate> {
  const now = new Date().toISOString();
  let updated: DatabaseMessageTemplate | null = null;
  try {
    await database.updateTemplate(id, {
      title: input.title.trim(),
      body: input.body.trim(),
      variable_mappings: JSON.stringify(input.variable_mappings ?? {}),
    });
    updated = await database.getTemplate(id);
  } catch (dbErr) {
    console.warn('Local update failed, trying cloud direct:', dbErr);
  }

  if (updated) {
    const decoded = decodeTemplateRecord(updated);
    void supabase.auth.getSession().then(({ data, error }) => {
      if (error) {
        console.warn('Could not check authentication for template sync:', error);
      } else if (data.session) {
        syncInBackground();
      }
    }).catch((error) => {
      console.warn('Could not check authentication for template sync:', error);
    });
    return decoded;
  }

  const { data, error } = await supabase
    .from('message_templates')
    .update({
      title: input.title.trim(),
      body: input.body.trim(),
      variable_mappings: input.variable_mappings ?? {},
      updated_at: now,
    })
    .eq('id', id)
    .select('id, title, body, variable_mappings, created_at, updated_at')
    .single();
  if (error) throw new Error(GENERIC_ERROR);
  return decodeTemplateRecord(data, 'synced');
}

export async function deleteTemplate(id: string): Promise<void> {
  try {
    await database.deleteTemplate(id);
  } catch (dbErr) {
    console.warn('Local delete failed, trying cloud direct:', dbErr);
    const { error } = await supabase.from('message_templates').delete().eq('id', id);
    if (error) throw new Error(GENERIC_ERROR);
    return;
  }

  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) {
    console.warn('Could not check authentication for template sync:', error);
  } else if (session) {
    syncInBackground();
  }
}

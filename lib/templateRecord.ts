import { isTemplateVariableMappings, type TemplateVariableMappings } from './templateMappings.ts';

export type MessageTemplate = {
  id: string;
  title: string;
  body: string;
  variable_mappings: TemplateVariableMappings;
  user_id?: string;
  is_default?: boolean;
  created_at: string;
  updated_at: string;
  sync_status?: 'synced' | 'pending' | 'conflict';
};

type SyncStatus = NonNullable<MessageTemplate['sync_status']>;

const syncStatuses = new Set<SyncStatus>(['synced', 'pending', 'conflict']);

function isSyncStatus(value: unknown): value is SyncStatus {
  return typeof value === 'string' && syncStatuses.has(value as SyncStatus);
}

export function decodeTemplateRecord(
  value: unknown,
  fallbackSyncStatus?: SyncStatus,
): MessageTemplate {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('بيانات القالب غير صالحة.');
  }

  const record = value as Record<string, unknown>;
  const rawMappings = record.variable_mappings;
  let variableMappings: TemplateVariableMappings = {};

  if (typeof rawMappings === 'string') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawMappings);
    } catch (error) {
      throw new Error('تعذر قراءة بيانات ربط متغيرات القالب.', { cause: error });
    }
    if (!isTemplateVariableMappings(parsed)) {
      throw new Error('بيانات ربط متغيرات القالب غير صالحة.');
    }
    variableMappings = parsed;
  } else if (rawMappings !== undefined) {
    if (!isTemplateVariableMappings(rawMappings)) {
      throw new Error('بيانات ربط متغيرات القالب غير صالحة.');
    }
    variableMappings = rawMappings;
  }

  const syncStatus = record.sync_status === undefined ? fallbackSyncStatus : record.sync_status;
  if (syncStatus !== undefined && !isSyncStatus(syncStatus)) {
    throw new Error('حالة مزامنة القالب غير صالحة.');
  }

  const isDefault = record.is_default;
  if (
    typeof record.id !== 'string' ||
    typeof record.title !== 'string' ||
    typeof record.body !== 'string' ||
    typeof record.created_at !== 'string' ||
    typeof record.updated_at !== 'string' ||
    (record.user_id !== undefined && typeof record.user_id !== 'string')
  ) {
    throw new Error('بيانات القالب لا تحتوي على الحقول المطلوبة.');
  }
  if (
    isDefault !== undefined &&
    isDefault !== true &&
    isDefault !== false &&
    isDefault !== 0 &&
    isDefault !== 1
  ) {
    throw new Error('قيمة تصنيف القالب الافتراضي غير صالحة.');
  }
  if (
    record.id.length === 0 ||
    record.title.length === 0 ||
    record.created_at.length === 0 ||
    record.updated_at.length === 0
  ) {
    throw new Error('بيانات القالب تحتوي على قيم مطلوبة فارغة.');
  }

  return {
    id: record.id,
    title: record.title,
    body: record.body,
    variable_mappings: variableMappings,
    ...(typeof record.user_id === 'string' ? { user_id: record.user_id } : {}),
    is_default: isDefault === true || isDefault === 1,
    created_at: record.created_at,
    updated_at: record.updated_at,
    ...(syncStatus === undefined ? {} : { sync_status: syncStatus }),
  };
}

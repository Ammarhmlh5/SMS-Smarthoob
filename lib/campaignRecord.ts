export type CampaignRecord = {
  id: string;
  name: string;
  template_id: string | null;
  connection_id: string | null;
  status: 'draft' | 'sending' | 'completed' | 'failed';
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  created_at: string;
  updated_at: string;
  sync_status?: 'synced' | 'pending' | 'conflict';
};

const campaignStatuses = new Set(['draft', 'sending', 'completed', 'failed']);
const syncStatuses = new Set(['synced', 'pending', 'conflict']);

export function isCampaignRecord(value: unknown): value is CampaignRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;

  return (
    typeof record.id === 'string' &&
    record.id.length > 0 &&
    typeof record.name === 'string' &&
    record.name.trim().length > 0 &&
    (record.template_id === null || typeof record.template_id === 'string') &&
    (record.connection_id === null || typeof record.connection_id === 'string') &&
    typeof record.status === 'string' &&
    campaignStatuses.has(record.status) &&
    Number.isSafeInteger(record.total_recipients) &&
    (record.total_recipients as number) >= 0 &&
    Number.isSafeInteger(record.sent_count) &&
    (record.sent_count as number) >= 0 &&
    Number.isSafeInteger(record.failed_count) &&
    (record.failed_count as number) >= 0 &&
    typeof record.created_at === 'string' &&
    Number.isFinite(Date.parse(record.created_at)) &&
    typeof record.updated_at === 'string' &&
    Number.isFinite(Date.parse(record.updated_at)) &&
    (record.sync_status === undefined ||
      (typeof record.sync_status === 'string' && syncStatuses.has(record.sync_status)))
  );
}

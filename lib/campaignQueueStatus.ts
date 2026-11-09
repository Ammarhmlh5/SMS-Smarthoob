export type CampaignQueueStatusStats = {
  pending: number;
  sending: number;
  sent: number;
  blocked: number;
};

export type CampaignQueueStatus = 'sending' | 'completed' | 'failed';

export function canResumeCampaignQueue(stats: Pick<CampaignQueueStatusStats, 'pending' | 'sending'>): boolean {
  return stats.pending > 0 && stats.sending === 0;
}

export function resolveCampaignQueueStatus(
  stats: CampaignQueueStatusStats,
  blockedByPolicy = false,
): CampaignQueueStatus {
  if (stats.sending > 0) return 'sending';
  if (stats.pending > 0) return 'failed';
  if (blockedByPolicy || stats.blocked > 0 || stats.sent === 0) return 'failed';
  return 'completed';
}

export const CAMPAIGN_CLAIM_LEASE_MS = 5 * 60 * 1000;
export const CAMPAIGN_CLAIM_HEARTBEAT_MS = 60 * 1000;
export const UNCERTAIN_DELIVERY_ERROR_PREFIX = 'نتيجة الإرسال غير مؤكدة؛';
export const EXPIRED_CLAIM_ERROR =
  `${UNCERTAIN_DELIVERY_ERROR_PREFIX} انتهت مهلة حجز الرسالة قبل تأكيد نتيجتها؛ لم تُعد تلقائياً لتجنب تكرار الإرسال. راجع البوابة قبل إعادة المحاولة.`;

export function isUncertainDeliveryError(error: string | null | undefined): boolean {
  return error?.startsWith(UNCERTAIN_DELIVERY_ERROR_PREFIX) ?? false;
}

export function getExpiredClaimRecoveryStatus(
  status: 'CLAIMED' | 'SENDING',
): 'RETRY_WAITING' | 'FAILED' {
  return status === 'CLAIMED' ? 'RETRY_WAITING' : 'FAILED';
}

export function isCampaignClaimExpired(updatedAt: string, now: number): boolean {
  const updatedAtMs = Date.parse(updatedAt);
  return Number.isFinite(updatedAtMs) && now - updatedAtMs >= CAMPAIGN_CLAIM_LEASE_MS;
}

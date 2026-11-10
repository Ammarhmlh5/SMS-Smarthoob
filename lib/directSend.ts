import { getGatewayConnection, fetchGatewaySettings } from './gatewaySettings';
import { sendGatewayMessageWithRetry } from './gatewayDelivery';
import { evaluateSendGate } from './sendGuard';
import { loadSettings, type AppSettings } from './settingsStore';
import { calculateEffectiveDelayMs, sleepForDelay } from './throttlePolicy';
import { normalizeSmsPhone } from './phoneNumber';

export type DirectSendRecipient = {
  phone: string;
  name: string;
  message: string;
};

export type DirectSendRecipientResult = {
  phone: string;
  name: string;
  status: 'sent' | 'failed';
  error?: string;
};

export type DirectSendResult = {
  total: number;
  sent: number;
  failed: number;
  recipients: DirectSendRecipientResult[];
};

export async function sendDirectMessages(
  connectionId: string,
  recipients: DirectSendRecipient[],
  onProgress?: (progress: { sent: number; failed: number; processed: number; total: number }) => void,
): Promise<DirectSendResult> {
  if (recipients.length === 0) {
    throw new Error('أضف مستلماً واحداً على الأقل قبل الإرسال.');
  }

  const preparedRecipients = recipients.map((recipient, index) => {
    const phone = normalizeSmsPhone(recipient.phone);
    if (!phone) {
      throw new Error(`رقم الهاتف للمستلم ${index + 1} غير صالح لإرسال SMS.`);
    }
    if (!recipient.message.trim()) {
      throw new Error(`نص الرسالة للمستلم ${index + 1} فارغ.`);
    }
    return { ...recipient, phone, message: recipient.message.trim() };
  });

  const [storedSettings, gatewaySettings, connection] = await Promise.all([
    loadSettings(),
    fetchGatewaySettings(),
    getGatewayConnection(connectionId),
  ]);
  const settings: AppSettings = {
    ...storedSettings,
    maxRetryAttempts: gatewaySettings.max_retries,
  };
  const gate = await evaluateSendGate({
    connectionId,
    recipientsCount: preparedRecipients.length,
    customSettings: settings,
  });
  if (!gate.canProceed) throw new Error(gate.message);

  let sent = 0;
  let failed = 0;
  const results: DirectSendRecipientResult[] = [];
  const delayBetweenMessages = calculateEffectiveDelayMs(settings, 0);

  for (const [index, recipient] of preparedRecipients.entries()) {
    if (index > 0 && delayBetweenMessages > 0) {
      await sleepForDelay(delayBetweenMessages);
    }

    try {
      await sendGatewayMessageWithRetry(
        connection,
        recipient.phone,
        recipient.message,
        settings.maxRetryAttempts,
        settings,
      );
      sent += 1;
      results.push({ phone: recipient.phone, name: recipient.name, status: 'sent' });
    } catch (error) {
      failed += 1;
      results.push({
        phone: recipient.phone,
        name: recipient.name,
        status: 'failed',
        error: error instanceof Error ? error.message : 'تعذر إرسال الرسالة.',
      });
    }

    onProgress?.({ sent, failed, processed: index + 1, total: preparedRecipients.length });
  }

  return { total: preparedRecipients.length, sent, failed, recipients: results };
}

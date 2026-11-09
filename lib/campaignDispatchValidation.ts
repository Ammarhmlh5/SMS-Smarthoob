type DispatchRecipient = {
  id: string;
  campaign_id: string;
  subscriber_phone: string;
  message_body: string;
};

type DispatchMessage = {
  phone: string;
  message: string;
  payload?: unknown;
};

export function validateCampaignDispatch(
  campaignId: string,
  declaredRecipientCount: number,
  recipients: DispatchRecipient[],
  messages: DispatchMessage[],
): void {
  if (recipients.length === 0) {
    throw new Error('لا يمكن إنشاء حملة إرسال دون مستلمين.');
  }
  if (declaredRecipientCount !== recipients.length || recipients.length !== messages.length) {
    throw new Error('عدد مستلمي الحملة لا يطابق عدد الرسائل في الطابور.');
  }

  const recipientIds = new Set<string>();
  for (let index = 0; index < recipients.length; index += 1) {
    const recipient = recipients[index];
    const message = messages[index];
    if (
      recipient.campaign_id !== campaignId ||
      !recipient.id ||
      recipientIds.has(recipient.id) ||
      !recipient.subscriber_phone ||
      message.phone !== recipient.subscriber_phone ||
      !message.message.trim() ||
      message.message !== recipient.message_body
    ) {
      throw new Error(`بيانات المستلم أو الرسالة رقم ${index + 1} غير متطابقة.`);
    }
    recipientIds.add(recipient.id);

    if (typeof message.payload !== 'object' || message.payload === null) {
      throw new Error(`بيانات الربط مع المستلم رقم ${index + 1} غير مكتملة.`);
    }
    const payload = message.payload as Record<string, unknown>;
    if (payload.recipientId !== recipient.id) {
      throw new Error(`معرّف المستلم في الرسالة رقم ${index + 1} غير متطابق.`);
    }
  }
}

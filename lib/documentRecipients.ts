export type DocumentCampaignRecipient = {
  phone: string;
  name: string;
  message: string;
  data: Record<string, string>;
};

export type DocumentRecipientMapping = {
  phoneColumn: string;
  messageColumn?: string;
};

type BuildDocumentRecipientsOptions = {
  columns: string[];
  records: Record<string, string>[];
  rowCount: number;
  mapping: Record<string, string>;
  recipientMapping?: DocumentRecipientMapping;
  suggestedPhoneColumn?: string;
  suggestedNameColumn?: string;
  templateBody?: string;
  renderMessage?: (body: string, data: Record<string, string>) => string;
};

const MESSAGE_COLUMN_PATTERN =
  /^(message|sms|message_body|sms_body|ready_message|prepared_message|رسالة جاهزة|رسالة_جاهزة|الرسالة الجاهزة|الرسالة_الجاهزة|نص الرسالة|نص_الرسالة|نص الرسالة الجاهزة|نص_الرسالة_الجاهزة|الرسالة)$/i;

export function isPreparedMessageColumn(column: string): boolean {
  return MESSAGE_COLUMN_PATTERN.test(column.trim());
}

export function buildDocumentRecipients({
  columns,
  records,
  rowCount,
  mapping,
  recipientMapping,
  suggestedPhoneColumn,
  suggestedNameColumn,
  templateBody,
  renderMessage,
}: BuildDocumentRecipientsOptions): DocumentCampaignRecipient[] {
  if (records.length === 0 || records.length !== rowCount) {
    throw new Error('بيانات المستند غير مكتملة؛ لا يمكن إرسال عينة جزئية.');
  }

  const phoneColumn = recipientMapping?.phoneColumn ||
    suggestedPhoneColumn ||
    mapping['الجوال'] ||
    mapping['الهاتف'] ||
    mapping['phone'] ||
    mapping['mobile'] ||
    columns.find((column) => /هاتف|جوال|phone|mobile|واتساب/i.test(column)) ||
    columns[0];
  if (!phoneColumn || !columns.includes(phoneColumn)) {
    throw new Error('حدد عمود رقم الهاتف في المستند.');
  }
  const nameColumn =
    suggestedNameColumn ||
    mapping['الاسم'] ||
    mapping['اسم'] ||
    mapping['name'] ||
    mapping['client'] ||
    mapping['customer'] ||
    columns.find((column) => /اسم|name|عميل|مشترك/i.test(column));
  const messageColumn = recipientMapping?.messageColumn ||
    columns.find(isPreparedMessageColumn);
  if (messageColumn && !columns.includes(messageColumn)) {
    throw new Error('حدد عمود الرسالة الموجود في المستند.');
  }

  if (!messageColumn && (!templateBody || !renderMessage)) {
    throw new Error('اختر قالباً أو استخدم مستنداً يحتوي على عمود جاهز للرسالة.');
  }

  return records.map((row, index) => {
    if (typeof row !== 'object' || row === null) {
      throw new Error(`صف المستند رقم ${index + 1} غير صالح.`);
    }

    const data: Record<string, string> = {};
    for (const [key, value] of Object.entries(row)) {
      if (typeof value !== 'string') {
        throw new Error(`قيمة غير نصية في صف المستند رقم ${index + 1}.`);
      }
      data[key] = value;
    }

    for (const [variable, column] of Object.entries(mapping)) {
      if (column && data[column] !== undefined) data[variable] = data[column];
    }

    const readyMessage = messageColumn ? data[messageColumn]?.trim() : '';
    const message = messageColumn
      ? readyMessage
      : (templateBody && renderMessage ? renderMessage(templateBody, data) : '');
    if (!message?.trim()) {
      throw new Error(`نص الرسالة فارغ في صف المستند رقم ${index + 1}.`);
    }

    return {
      phone: data[phoneColumn]?.trim() ?? '',
      name: nameColumn && data[nameColumn]?.trim()
        ? data[nameColumn].trim()
        : `مشترك ${index + 1}`,
      message,
      data,
    };
  });
}

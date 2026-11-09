import type { AppSettings } from './settingsStore';

export type StoredSettingValues = {
  apiBaseUrl: string | null;
  delayBetweenMs: string | null;
  batchSize: string | null;
  maxRetryAttempts: string | null;
  enableRemoteSend: string | null;
};

export function validateRemoteSendSetting(value: unknown): string | null {
  return typeof value === 'boolean' ? null : 'قيمة تفعيل الإرسال يجب أن تكون منطقية صريحة.';
}

export function validateSettings(settings: Partial<AppSettings>): string | null {
  if (
    settings.batchSize !== undefined &&
    (!Number.isSafeInteger(settings.batchSize) || settings.batchSize < 1 || settings.batchSize > 200)
  ) {
    return 'حجم الدفعة يجب أن يكون عدداً صحيحاً بين 1 و 200';
  }
  if (
    settings.delayBetweenMs !== undefined &&
    (!Number.isSafeInteger(settings.delayBetweenMs) || settings.delayBetweenMs < 0)
  ) {
    return 'التأخير يجب أن يكون عدداً صحيحاً لا يقل عن 0';
  }
  if (
    settings.maxRetryAttempts !== undefined &&
    (!Number.isSafeInteger(settings.maxRetryAttempts) ||
      settings.maxRetryAttempts < 0 ||
      settings.maxRetryAttempts > 10)
  ) {
    return 'محاولات إعادة الإرسال يجب أن تكون عدداً صحيحاً بين 0 و 10';
  }
  if (settings.apiBaseUrl !== undefined && settings.apiBaseUrl.trim().length === 0) {
    return 'عنوان الخادم لا يمكن أن يكون فارغاً';
  }
  if (
    settings.enableRemoteSend !== undefined &&
    validateRemoteSendSetting(settings.enableRemoteSend)
  ) {
    return 'قيمة تفعيل الإرسال يجب أن تكون منطقية صريحة.';
  }
  return null;
}

function parseIntegerSetting(
  value: string | null,
  fallback: number,
  key: string,
  minimum: number,
  maximum?: number,
): number {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value)) {
    throw new Error(`القيمة المحفوظة للإعداد ${key} ليست عدداً صحيحاً صالحاً.`);
  }

  const parsed = Number(value);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < minimum ||
    (maximum !== undefined && parsed > maximum)
  ) {
    const range =
      maximum === undefined ? `أكبر من أو تساوي ${minimum}` : `بين ${minimum} و${maximum}`;
    throw new Error(`القيمة المحفوظة للإعداد ${key} يجب أن تكون ${range}.`);
  }
  return parsed;
}

export function parseStoredSettings(
  values: StoredSettingValues,
  defaults: AppSettings,
): AppSettings {
  const apiBaseUrl = values.apiBaseUrl === null
    ? defaults.apiBaseUrl
    : values.apiBaseUrl.trim();
  if (!apiBaseUrl) throw new Error('عنوان خادم التحليل المحفوظ فارغ.');

  const enableRemoteSend = values.enableRemoteSend === null
    ? defaults.enableRemoteSend
    : values.enableRemoteSend === 'true'
      ? true
      : values.enableRemoteSend === 'false'
        ? false
        : null;
  if (enableRemoteSend === null) {
    throw new Error('قيمة تفعيل الإرسال المحفوظة غير صالحة.');
  }

  return {
    apiBaseUrl,
    delayBetweenMs: parseIntegerSetting(
      values.delayBetweenMs,
      defaults.delayBetweenMs,
      'التأخير',
      0,
    ),
    batchSize: parseIntegerSetting(
      values.batchSize,
      defaults.batchSize,
      'حجم الدفعة',
      1,
      200,
    ),
    maxRetryAttempts: parseIntegerSetting(
      values.maxRetryAttempts,
      defaults.maxRetryAttempts,
      'محاولات الإعادة',
      0,
      10,
    ),
    enableRemoteSend,
  };
}

/**
 * settingsStore.ts
 * إدارة إعدادات التطبيق المحلية عبر AsyncStorage.
 * - عنوان خادم الذكاء الاصطناعي (FastAPI)
 * - تفضيلات الإرسال: حجم الدفعة، التأخير، إعادة المحاولة
 * - feature flag: تفعيل الإرسال الفعلي (enableRemoteSend)
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── أنواع البيانات ───────────────────────────────────────────────────────────

export interface AppSettings {
  /** عنوان خادم FastAPI */
  apiBaseUrl: string;
  /** التأخير بين الرسائل بالمللي ثانية */
  delayBetweenMs: number;
  /** حجم الدفعة الواحدة */
  batchSize: number;
  /** الحد الأقصى لمحاولات إعادة الإرسال */
  maxRetryAttempts: number;
  /** تفعيل الإرسال الفعلي (يجب أن يكون false افتراضياً) */
  enableRemoteSend: boolean;
}

// ─── القيم الافتراضية ─────────────────────────────────────────────────────────

export const DEFAULT_SETTINGS: AppSettings = {
  apiBaseUrl: 'http://10.0.2.2:8000',
  delayBetweenMs: 500,
  batchSize: 50,
  maxRetryAttempts: 3,
  enableRemoteSend: false,
};

// ─── مفاتيح AsyncStorage ──────────────────────────────────────────────────────

const KEYS = {
  apiBaseUrl: '@sms_smarthoob:api_base_url',
  delayBetweenMs: '@sms_smarthoob:delay_between_ms',
  batchSize: '@sms_smarthoob:batch_size',
  maxRetryAttempts: '@sms_smarthoob:max_retry_attempts',
  enableRemoteSend: '@sms_smarthoob:enable_remote_send',
} as const;

// ─── القراءة ─────────────────────────────────────────────────────────────────

/** يقرأ جميع إعدادات التطبيق من AsyncStorage مع الرجوع للقيم الافتراضية */
export async function loadSettings(): Promise<AppSettings> {
  try {
    const [apiBaseUrl, delayBetweenMs, batchSize, maxRetryAttempts, enableRemoteSend] =
      await Promise.all([
        AsyncStorage.getItem(KEYS.apiBaseUrl),
        AsyncStorage.getItem(KEYS.delayBetweenMs),
        AsyncStorage.getItem(KEYS.batchSize),
        AsyncStorage.getItem(KEYS.maxRetryAttempts),
        AsyncStorage.getItem(KEYS.enableRemoteSend),
      ]);

    return {
      apiBaseUrl: apiBaseUrl ?? DEFAULT_SETTINGS.apiBaseUrl,
      delayBetweenMs: delayBetweenMs !== null ? parseInt(delayBetweenMs, 10) : DEFAULT_SETTINGS.delayBetweenMs,
      batchSize: batchSize !== null ? parseInt(batchSize, 10) : DEFAULT_SETTINGS.batchSize,
      maxRetryAttempts:
        maxRetryAttempts !== null ? parseInt(maxRetryAttempts, 10) : DEFAULT_SETTINGS.maxRetryAttempts,
      enableRemoteSend: enableRemoteSend === 'true',
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

// ─── الحفظ الجزئي ────────────────────────────────────────────────────────────

/** يحفظ عنوان خادم FastAPI */
export async function saveApiBaseUrl(url: string): Promise<void> {
  await AsyncStorage.setItem(KEYS.apiBaseUrl, url.trim());
}

/** يحفظ إعدادات الإرسال (الدفعة والتأخير وإعادة المحاولة) */
export async function saveSendingConfig(config: {
  batchSize: number;
  delayBetweenMs: number;
  maxRetryAttempts: number;
}): Promise<void> {
  await Promise.all([
    AsyncStorage.setItem(KEYS.batchSize, String(config.batchSize)),
    AsyncStorage.setItem(KEYS.delayBetweenMs, String(config.delayBetweenMs)),
    AsyncStorage.setItem(KEYS.maxRetryAttempts, String(config.maxRetryAttempts)),
  ]);
}

/** يفعّل أو يعطّل الإرسال الفعلي */
export async function setEnableRemoteSend(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(KEYS.enableRemoteSend, enabled ? 'true' : 'false');
}

/** يحفظ جميع الإعدادات دفعةً واحدة */
export async function saveAllSettings(settings: AppSettings): Promise<void> {
  await Promise.all([
    AsyncStorage.setItem(KEYS.apiBaseUrl, settings.apiBaseUrl.trim()),
    AsyncStorage.setItem(KEYS.delayBetweenMs, String(settings.delayBetweenMs)),
    AsyncStorage.setItem(KEYS.batchSize, String(settings.batchSize)),
    AsyncStorage.setItem(KEYS.maxRetryAttempts, String(settings.maxRetryAttempts)),
    AsyncStorage.setItem(KEYS.enableRemoteSend, settings.enableRemoteSend ? 'true' : 'false'),
  ]);
}

// ─── التحقق من القيم ──────────────────────────────────────────────────────────

export function validateSettings(settings: Partial<AppSettings>): string | null {
  if (settings.batchSize !== undefined && (settings.batchSize < 1 || settings.batchSize > 200)) {
    return 'حجم الدفعة يجب أن يكون بين 1 و 200';
  }
  if (settings.delayBetweenMs !== undefined && settings.delayBetweenMs < 0) {
    return 'التأخير يجب أن يكون 0 أو أكثر';
  }
  if (settings.maxRetryAttempts !== undefined && (settings.maxRetryAttempts < 0 || settings.maxRetryAttempts > 10)) {
    return 'محاولات إعادة الإرسال يجب أن تكون بين 0 و 10';
  }
  if (settings.apiBaseUrl !== undefined && settings.apiBaseUrl.trim().length === 0) {
    return 'عنوان الخادم لا يمكن أن يكون فارغاً';
  }
  return null;
}

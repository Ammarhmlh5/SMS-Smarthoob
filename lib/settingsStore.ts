/**
 * settingsStore.ts
 * إدارة إعدادات التطبيق المحلية عبر AsyncStorage.
 * - عنوان خادم الذكاء الاصطناعي (FastAPI)
 * - تفضيلات الإرسال: حجم الدفعة، التأخير، إعادة المحاولة
 * - feature flag: تفعيل الإرسال الفعلي (enableRemoteSend)
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  parseStoredSettings,
  validateRemoteSendSetting,
  validateSettings,
} from './settingsValidation';

export { validateSettings } from './settingsValidation';

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

    return parseStoredSettings(
      { apiBaseUrl, delayBetweenMs, batchSize, maxRetryAttempts, enableRemoteSend },
      DEFAULT_SETTINGS,
    );
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `تعذر تحميل إعدادات التطبيق: ${error.message}`
        : 'تعذر تحميل إعدادات التطبيق من التخزين المحلي.',
      { cause: error },
    );
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
  const validationError = validateSettings(config);
  if (validationError) throw new Error(validationError);

  await Promise.all([
    AsyncStorage.setItem(KEYS.batchSize, String(config.batchSize)),
    AsyncStorage.setItem(KEYS.delayBetweenMs, String(config.delayBetweenMs)),
    AsyncStorage.setItem(KEYS.maxRetryAttempts, String(config.maxRetryAttempts)),
  ]);
}

/** يفعّل أو يعطّل الإرسال الفعلي */
export async function setEnableRemoteSend(enabled: boolean): Promise<void> {
  const validationError = validateRemoteSendSetting(enabled);
  if (validationError) throw new Error(validationError);

  await AsyncStorage.setItem(KEYS.enableRemoteSend, enabled ? 'true' : 'false');
}

/** يحفظ جميع الإعدادات دفعةً واحدة */
export async function saveAllSettings(settings: AppSettings): Promise<void> {
  const validationError = validateSettings(settings);
  if (validationError) throw new Error(validationError);

  await Promise.all([
    AsyncStorage.setItem(KEYS.apiBaseUrl, settings.apiBaseUrl.trim()),
    AsyncStorage.setItem(KEYS.delayBetweenMs, String(settings.delayBetweenMs)),
    AsyncStorage.setItem(KEYS.batchSize, String(settings.batchSize)),
    AsyncStorage.setItem(KEYS.maxRetryAttempts, String(settings.maxRetryAttempts)),
    AsyncStorage.setItem(KEYS.enableRemoteSend, settings.enableRemoteSend ? 'true' : 'false'),
  ]);
}

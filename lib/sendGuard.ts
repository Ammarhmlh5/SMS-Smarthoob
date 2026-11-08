/**
 * sendGuard.ts
 * طبقة الحماية والتفويض قبل إرسال الرسائل (Send Gate).
 * تتحقق من:
 * 1. وجود جلسة مستخدم نشطة ومصادقة
 * 2. تفعيل مفتاح ميزة الإرسال الفعلي (enableRemoteSend Feature Flag)
 * 3. وجود اتصال/بوابة محددة للحملة
 * 4. جاهزية البيانات والمستلمين
 */

import { supabase } from './supabase';
import { loadSettings } from './settingsStore';
import type { AppSettings } from './settingsStore';

export type SendGateStatus =
  | 'APPROVED'
  | 'BLOCKED_NO_SESSION'
  | 'BLOCKED_FEATURE_DISABLED'
  | 'BLOCKED_MISSING_GATEWAY'
  | 'BLOCKED_NO_RECIPIENTS'
  | 'BLOCKED_INVALID_STATE';

export interface SendGateResult {
  status: SendGateStatus;
  canProceed: boolean;
  message: string;
}

export interface SendGateParams {
  connectionId?: string | null;
  recipientsCount?: number;
  customSettings?: AppSettings;
}

/**
 * تقييم شروط حماية الإرسال قبل تنفيذ أي عملية رفع أو إرسال فعلي
 */
export async function evaluateSendGate(params: SendGateParams): Promise<SendGateResult> {
  // 1. التحقق من جلسة المستخدم
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      return {
        status: 'BLOCKED_NO_SESSION',
        canProceed: false,
        message: 'يجب تسجيل الدخول أولاً قبل بدء إرسال الحملات.',
      };
    }
  } catch {
    return {
      status: 'BLOCKED_NO_SESSION',
      canProceed: false,
      message: 'تعذر التحقق من جلسة المستخدم. يرجى تسجيل الدخول مجدداً.',
    };
  }

  // 2. التحقق من تفعيل مفتاح الإرسال الفعلي (Feature Flag)
  const settings = params.customSettings ?? (await loadSettings());
  if (!settings.enableRemoteSend) {
    return {
      status: 'BLOCKED_FEATURE_DISABLED',
      canProceed: false,
      message:
        'الإرسال الفعلي معطّل في إعدادات التطبيق. يمكنك تفعيله من تبويب الإعدادات -> إعدادات الإرسال والدفعات.',
    };
  }

  // 3. التحقق من تحديد اتصال البوابة
  if (!params.connectionId || params.connectionId.trim() === '') {
    return {
      status: 'BLOCKED_MISSING_GATEWAY',
      canProceed: false,
      message: 'يرجى تحديد بوابة الإرسال المعتمدة لهذه الحملة.',
    };
  }

  // 4. التحقق من وجود مستلمين
  if (params.recipientsCount !== undefined && params.recipientsCount <= 0) {
    return {
      status: 'BLOCKED_NO_RECIPIENTS',
      canProceed: false,
      message: 'لا يوجد مستلمون في هذه الحملة للإرسال إليهم.',
    };
  }

  // الشروط جميعها مستوفاة
  return {
    status: 'APPROVED',
    canProceed: true,
    message: 'جاهز للإرسال.',
  };
}

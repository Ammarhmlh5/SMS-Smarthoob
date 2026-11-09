export function isSuccessfulConnectionTestStatus(status: number): boolean {
  return status >= 200 && status < 400;
}

export function getConnectionTestError(error: unknown): string {
  if (error instanceof Error && error.name === 'AbortError') {
    return 'انتهت مهلة اختبار الاتصال قبل وصول استجابة.';
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  return 'تعذر الاتصال بعنوان الخدمة. تحقق من الشبكة والعنوان ثم أعد المحاولة.';
}

const DIGIT_MAP: Record<string, string> = {
  '٠': '0',
  '١': '1',
  '٢': '2',
  '٣': '3',
  '٤': '4',
  '٥': '5',
  '٦': '6',
  '٧': '7',
  '٨': '8',
  '٩': '9',
  '۰': '0',
  '۱': '1',
  '۲': '2',
  '۳': '3',
  '۴': '4',
  '۵': '5',
  '۶': '6',
  '۷': '7',
  '۸': '8',
  '۹': '9',
};

export function normalizeSmsPhone(value: string): string | null {
  let phone = value
    .replace(/[٠-٩۰-۹]/g, (digit) => DIGIT_MAP[digit])
    .replace(/[\s()-]/g, '');

  if (phone.startsWith('00')) phone = `+${phone.slice(2)}`;
  return /^\+?[0-9]{7,15}$/.test(phone) ? phone : null;
}

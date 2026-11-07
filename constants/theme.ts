export const colors = {
  primary: {
    50: '#ECFDF9',
    100: '#CCFBEF',
    200: '#99F6E0',
    500: '#14B8A6',
    600: '#0D9488',
    700: '#0F766E',
    800: '#115E59',
  },
  secondary: {
    500: '#0EA5E9',
    600: '#0284C7',
  },
  accent: {
    400: '#FBBF24',
    500: '#F59E0B',
  },
  success: { 500: '#22C55E', 600: '#16A34A' },
  warning: { 500: '#F59E0B', 600: '#D97706' },
  error: { 500: '#EF4444', 600: '#DC2626' },
  neutral: {
    0: '#FFFFFF',
    50: '#F8FAFC',
    100: '#F1F5F9',
    200: '#E2E8F0',
    400: '#94A3B8',
    500: '#64748B',
    700: '#334155',
    900: '#0F172A',
  },
} as const;

export const spacing = {
  xs: 8,
  sm: 16,
  md: 24,
  lg: 32,
} as const;

export const fonts = {
  regular: 'Cairo-Regular',
  semibold: 'Cairo-SemiBold',
  bold: 'Cairo-Bold',
} as const;

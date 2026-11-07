import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { colors, fonts, spacing } from '@/constants/theme';

type FieldProps = {
  label: string;
  Icon: LucideIcon;
  hint?: string;
  children: ReactNode;
};

export function Field({ label, Icon, hint, children }: FieldProps) {
  return (
    <View style={formStyles.field}>
      <View style={formStyles.labelRow}>
        <Icon size={16} color={colors.neutral[500]} strokeWidth={2} />
        <Text style={formStyles.label}>{label}</Text>
        {hint ? <Text style={formStyles.hint}>{hint}</Text> : null}
      </View>
      {children}
    </View>
  );
}

export const formStyles = StyleSheet.create({
  form: {
    gap: spacing.sm,
  },
  field: {
    gap: spacing.xs / 2,
  },
  labelRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.xs / 2,
  },
  label: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    lineHeight: 21,
    color: colors.neutral[700],
    writingDirection: 'rtl',
  },
  hint: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 18,
    color: colors.neutral[400],
    writingDirection: 'rtl',
  },
  input: {
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 22,
    color: colors.neutral[900],
    backgroundColor: colors.neutral[50],
    borderWidth: 1,
    borderColor: colors.neutral[200],
    borderRadius: 14,
    paddingHorizontal: spacing.sm,
    paddingVertical: 12,
    textAlign: 'right',
  },
  ltrText: {
    textAlign: 'left',
    writingDirection: 'ltr',
  },
  errorText: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    lineHeight: 21,
    color: colors.error[600],
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  successRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.xs / 2,
  },
  successText: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    lineHeight: 21,
    color: colors.success[600],
    writingDirection: 'rtl',
  },
  saveButton: {
    height: 52,
    borderRadius: 14,
    backgroundColor: colors.primary[700],
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xs / 2,
  },
  saveText: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.neutral[0],
    writingDirection: 'rtl',
  },
  pressed: {
    opacity: 0.85,
  },
  disabled: {
    opacity: 0.6,
  },
});

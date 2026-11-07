import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { CheckCircle2, Layers, Minus, Plus, RotateCcw } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Field, formStyles as styles } from '@/components/FormField';
import { saveSendingPreferences } from '@/lib/gatewaySettings';
import type { GatewaySettings } from '@/lib/gatewaySettings';
import { colors, fonts, spacing } from '@/constants/theme';

const BATCH_SIZE = { min: 10, max: 100, step: 10 };
const RETRIES = { min: 0, max: 5, step: 1 };

type SendingPreferencesFormProps = {
  initial: GatewaySettings;
  onSaved: (settings: GatewaySettings) => void;
};

type StepperProps = {
  value: number;
  unit: string;
  min: number;
  max: number;
  step: number;
  disabled: boolean;
  onChange: (value: number) => void;
};

function Stepper({ value, unit, min, max, step, disabled, onChange }: StepperProps) {
  const canDecrease = !disabled && value - step >= min;
  const canIncrease = !disabled && value + step <= max;

  return (
    <View style={stepperStyles.row}>
      <StepButton label="تقليل" disabled={!canDecrease} onPress={() => onChange(value - step)} Icon={Minus} />
      <View style={stepperStyles.valueBox}>
        <Text style={stepperStyles.value}>{value}</Text>
        <Text style={stepperStyles.unit}>{unit}</Text>
      </View>
      <StepButton label="زيادة" disabled={!canIncrease} onPress={() => onChange(value + step)} Icon={Plus} />
    </View>
  );
}

type StepButtonProps = {
  label: string;
  disabled: boolean;
  onPress: () => void;
  Icon: LucideIcon;
};

function StepButton({ label, disabled, onPress, Icon }: StepButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        stepperStyles.button,
        pressed && !disabled && stepperStyles.buttonPressed,
        disabled && stepperStyles.buttonDisabled,
      ]}
    >
      <Icon size={20} color={disabled ? colors.neutral[400] : colors.primary[700]} strokeWidth={2.5} />
    </Pressable>
  );
}

export function SendingPreferencesForm({ initial, onSaved }: SendingPreferencesFormProps) {
  const [batchSize, setBatchSize] = useState(initial.batch_size);
  const [maxRetries, setMaxRetries] = useState(initial.max_retries);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const changed = batchSize !== initial.batch_size || maxRetries !== initial.max_retries;

  const updateValue = (setter: (value: number) => void) => (value: number) => {
    setter(value);
    setSaved(false);
    setError(null);
  };

  const reset = () => {
    setBatchSize(initial.batch_size);
    setMaxRetries(initial.max_retries);
    setError(null);
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const result = await saveSendingPreferences({ batch_size: batchSize, max_retries: maxRetries });
      setSaved(true);
      onSaved(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حفظ إعدادات الإرسال. حاول مرة أخرى.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.form}>
      <Field label="عدد الرسائل في كل دفعة" Icon={Layers} hint="بين 10 و 100">
        <Stepper
          value={batchSize}
          unit="رسالة"
          min={BATCH_SIZE.min}
          max={BATCH_SIZE.max}
          step={BATCH_SIZE.step}
          disabled={saving}
          onChange={updateValue(setBatchSize)}
        />
      </Field>

      <Field label="محاولات إعادة الإرسال عند الفشل" Icon={RotateCcw} hint="بين 0 و 5">
        <Stepper
          value={maxRetries}
          unit="محاولة"
          min={RETRIES.min}
          max={RETRIES.max}
          step={RETRIES.step}
          disabled={saving}
          onChange={updateValue(setMaxRetries)}
        />
      </Field>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {saved ? (
        <View style={styles.successRow}>
          <CheckCircle2 size={18} color={colors.success[600]} strokeWidth={2} />
          <Text style={styles.successText}>تم حفظ إعدادات الإرسال</Text>
        </View>
      ) : null}

      <View style={stepperStyles.actions}>
        {changed ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="تراجع عن التعديلات"
            onPress={reset}
            disabled={saving}
            style={({ pressed }) => [stepperStyles.cancelButton, pressed && styles.pressed]}
          >
            <Text style={stepperStyles.cancelText}>تراجع</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="حفظ إعدادات الإرسال"
          onPress={handleSave}
          disabled={!changed || saving}
          style={({ pressed }) => [
            styles.saveButton,
            stepperStyles.saveButton,
            pressed && styles.pressed,
            (!changed || saving) && styles.disabled,
          ]}
        >
          {saving ? (
            <ActivityIndicator color={colors.neutral[0]} />
          ) : (
            <Text style={styles.saveText}>حفظ إعدادات الإرسال</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const stepperStyles = StyleSheet.create({
  row: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  valueBox: {
    flex: 1,
    flexDirection: 'row-reverse',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: spacing.xs / 2,
  },
  value: {
    fontFamily: fonts.bold,
    fontSize: 22,
    lineHeight: 30,
    color: colors.neutral[900],
  },
  unit: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 21,
    color: colors.neutral[500],
    writingDirection: 'rtl',
  },
  button: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: colors.primary[50],
    borderWidth: 1,
    borderColor: colors.primary[200],
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: {
    opacity: 0.8,
  },
  buttonDisabled: {
    backgroundColor: colors.neutral[100],
    borderColor: colors.neutral[200],
  },
  actions: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.xs,
  },
  saveButton: {
    flex: 1,
    marginTop: 0,
  },
  cancelButton: {
    height: 52,
    paddingHorizontal: spacing.sm,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.neutral[200],
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: {
    fontFamily: fonts.semibold,
    fontSize: 15,
    color: colors.neutral[700],
    writingDirection: 'rtl',
  },
});

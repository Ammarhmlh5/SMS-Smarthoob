import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { CheckCircle2, Clock, Layers, Minus, Plus, RotateCcw, Send } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Field, formStyles as styles } from '@/components/FormField';
import { saveSendingPreferences } from '@/lib/gatewaySettings';
import type { GatewaySettings } from '@/lib/gatewaySettings';
import { saveSendingConfig, setEnableRemoteSend } from '@/lib/settingsStore';
import type { AppSettings } from '@/lib/settingsStore';
import { colors, fonts, spacing } from '@/constants/theme';

const BATCH_SIZE = { min: 10, max: 100, step: 10 };
const RETRIES = { min: 0, max: 5, step: 1 };
const DELAY_MS = { min: 0, max: 5000, step: 100 };

type SendingPreferencesFormProps = {
  initial: GatewaySettings;
  appSettings: AppSettings;
  onSaved: (settings: GatewaySettings) => void;
  onAppSettingsSaved: (settings: AppSettings) => void;
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

export function SendingPreferencesForm({
  initial,
  appSettings,
  onSaved,
  onAppSettingsSaved,
}: SendingPreferencesFormProps) {
  const [batchSize, setBatchSize] = useState(initial.batch_size);
  const [maxRetries, setMaxRetries] = useState(initial.max_retries);
  const [delayBetweenMs, setDelayBetweenMs] = useState(appSettings.delayBetweenMs);
  const [enableRemoteSend, setEnableRemoteSendState] = useState(appSettings.enableRemoteSend);
  const [saving, setSaving] = useState(false);
  const [togglingRemoteSend, setTogglingRemoteSend] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const gatewayChanged = batchSize !== initial.batch_size || maxRetries !== initial.max_retries;
  const localChanged = delayBetweenMs !== appSettings.delayBetweenMs;
  const changed = gatewayChanged || localChanged;

  const updateValue = (setter: (value: number) => void) => (value: number) => {
    setter(value);
    setSaved(false);
    setError(null);
  };

  const reset = () => {
    setBatchSize(initial.batch_size);
    setMaxRetries(initial.max_retries);
    setDelayBetweenMs(appSettings.delayBetweenMs);
    setError(null);
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      // حفظ إعدادات البوابة مباشرة في Supabase
      const result = await saveSendingPreferences({ batch_size: batchSize, max_retries: maxRetries });
      // حفظ الإعدادات المحلية في AsyncStorage
      await saveSendingConfig({ batchSize, delayBetweenMs, maxRetryAttempts: maxRetries });
      setSaved(true);
      onSaved(result);
      onAppSettingsSaved({ ...appSettings, batchSize, delayBetweenMs, maxRetryAttempts: maxRetries });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حفظ إعدادات الإرسال. حاول مرة أخرى.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleRemoteSend = async (value: boolean) => {
    setTogglingRemoteSend(true);
    try {
      await setEnableRemoteSend(value);
      setEnableRemoteSendState(value);
      onAppSettingsSaved({ ...appSettings, enableRemoteSend: value });
    } catch {
      // في حال فشل التخزين نعود للقيمة السابقة
      setEnableRemoteSendState(!value);
    } finally {
      setTogglingRemoteSend(false);
    }
  };

  return (
    <View style={styles.form}>
      {/* حجم الدفعة */}
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

      {/* التأخير بين الرسائل */}
      <Field label="التأخير بين الرسائل" Icon={Clock} hint="بالمللي ثانية (0–5000)">
        <Stepper
          value={delayBetweenMs}
          unit="ms"
          min={DELAY_MS.min}
          max={DELAY_MS.max}
          step={DELAY_MS.step}
          disabled={saving}
          onChange={updateValue(setDelayBetweenMs)}
        />
      </Field>

      {/* محاولات إعادة الإرسال */}
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

      {/* Send Gate — تفعيل الإرسال الفعلي */}
      <View style={stepperStyles.gateDivider} />
      <View style={stepperStyles.gateRow}>
        <View style={stepperStyles.gateInfo}>
          <View style={stepperStyles.gateTitleRow}>
            <Send size={16} color={enableRemoteSend ? colors.success[600] : colors.neutral[400]} strokeWidth={2} />
            <Text style={[stepperStyles.gateTitle, enableRemoteSend && stepperStyles.gateTitleActive]}>
              {enableRemoteSend ? 'الإرسال الفعلي مفعّل' : 'الإرسال الفعلي معطّل'}
            </Text>
          </View>
          <Text style={stepperStyles.gateHint}>
            {enableRemoteSend
              ? 'سيُرسَل الحملات فعلياً عند الضغط على إرسال'
              : 'الحملات تُحفظ محلياً فقط — فعّل للإرسال الفعلي'}
          </Text>
        </View>
        <Switch
          value={enableRemoteSend}
          onValueChange={handleToggleRemoteSend}
          disabled={togglingRemoteSend}
          trackColor={{ false: colors.neutral[200], true: colors.success[600] + 'AA' }}
          thumbColor={enableRemoteSend ? colors.success[600] : colors.neutral[400]}
        />
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
  // Send Gate styles
  gateDivider: {
    height: 1,
    backgroundColor: colors.neutral[100],
    marginVertical: 4,
  },
  gateRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingVertical: 4,
  },
  gateInfo: {
    flex: 1,
    gap: 4,
  },
  gateTitleRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
  },
  gateTitle: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.neutral[500],
    writingDirection: 'rtl',
  },
  gateTitleActive: {
    color: colors.success[700],
  },
  gateHint: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.neutral[400],
    textAlign: 'right',
    writingDirection: 'rtl',
  },
});

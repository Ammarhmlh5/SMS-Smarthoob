import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyRound, Link2, Tag, X } from 'lucide-react-native';
import { Field, formStyles as styles } from '@/components/FormField';
import { createGatewayConnection, updateGatewayConnection } from '@/lib/gatewaySettings';
import type { GatewayConnection } from '@/lib/gatewaySettings';
import { colors, spacing } from '@/constants/theme';

const MAX_SENDER_LENGTH = 11;

type ConnectionFormProps = {
  connection: GatewayConnection | null;
  onSaved: (connection: GatewayConnection) => void;
  onCancel: () => void;
};

function validate(endpoint: string, senderName: string, apiKey: string, isEdit: boolean): string | null {
  let parsed: URL;
  try {
    parsed = new URL(endpoint.trim());
  } catch {
    return 'أدخل عنوان الخدمة كاملاً، ويبدأ بـ https://';
  }
  if (parsed.protocol !== 'https:') return 'يجب أن يبدأ عنوان الخدمة بـ https://';
  const sender = senderName.trim();
  if (sender.length === 0 || sender.length > MAX_SENDER_LENGTH) {
    return `اسم المرسل يجب أن يكون بين 1 و ${MAX_SENDER_LENGTH} حرفاً`;
  }
  if (!isEdit && apiKey.trim().length === 0) return 'أدخل مفتاح الربط';
  return null;
}

export function ConnectionForm({ connection, onSaved, onCancel }: ConnectionFormProps) {
  const isEdit = connection !== null;
  const [endpoint, setEndpoint] = useState(connection?.endpoint_url ?? '');
  const [senderName, setSenderName] = useState(connection?.sender_name ?? '');
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changeField = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    setError(null);
  };

  const handleSave = async () => {
    const validationError = validate(endpoint, senderName, apiKey, isEdit);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const input = {
        endpoint_url: endpoint.trim(),
        sender_name: senderName.trim(),
        api_key: apiKey.trim(),
      };
      const saved = connection
        ? await updateGatewayConnection(connection.id, input)
        : await createGatewayConnection(input);
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حفظ الخدمة. حاول مرة أخرى.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.form}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>{isEdit ? 'تعديل الخدمة' : 'إضافة خدمة جديدة'}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="إغلاق النموذج"
          onPress={onCancel}
          disabled={saving}
          style={({ pressed }) => [localStyles.closeButton, pressed && styles.pressed]}
        >
          <X size={18} color={colors.neutral[500]} strokeWidth={2} />
        </Pressable>
      </View>

      <Field label="عنوان خدمة الرسائل" Icon={Link2}>
        <TextInput
          value={endpoint}
          onChangeText={changeField(setEndpoint)}
          placeholder="https://api.example.com/send"
          placeholderTextColor={colors.neutral[400]}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          editable={!saving}
          style={[styles.input, styles.ltrText]}
        />
      </Field>

      <Field label="مفتاح الربط" Icon={KeyRound} hint={isEdit ? 'اتركه فارغاً للإبقاء على المفتاح الحالي' : undefined}>
        <TextInput
          value={apiKey}
          onChangeText={changeField(setApiKey)}
          placeholder={isEdit ? 'محفوظ، اكتب مفتاحاً جديداً للتغيير' : 'أدخل مفتاح الربط'}
          placeholderTextColor={colors.neutral[400]}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          editable={!saving}
          style={[styles.input, styles.ltrText]}
        />
      </Field>

      <Field label="اسم المرسل" Icon={Tag} hint={`حتى ${MAX_SENDER_LENGTH} حرفاً`}>
        <TextInput
          value={senderName}
          onChangeText={changeField(setSenderName)}
          placeholder="مثال: الشركة"
          placeholderTextColor={colors.neutral[400]}
          maxLength={MAX_SENDER_LENGTH}
          editable={!saving}
          style={styles.input}
        />
      </Field>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={isEdit ? 'حفظ التعديلات' : 'حفظ الخدمة'}
        onPress={handleSave}
        disabled={saving}
        style={({ pressed }) => [styles.saveButton, pressed && styles.pressed, saving && styles.disabled]}
      >
        {saving ? (
          <ActivityIndicator color={colors.neutral[0]} />
        ) : (
          <Text style={styles.saveText}>{isEdit ? 'حفظ التعديلات' : 'حفظ الخدمة'}</Text>
        )}
      </Pressable>
    </View>
  );
}

const localStyles = StyleSheet.create({
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.xs / 2,
  },
});

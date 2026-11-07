import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { MessageSquare, Type, X } from 'lucide-react-native';
import { Field, formStyles as styles } from '@/components/FormField';
import { createTemplate, updateTemplate, extractPlaceholders } from '@/lib/templates';
import type { MessageTemplate } from '@/lib/templates';
import { colors, fonts, spacing } from '@/constants/theme';

const MAX_TITLE = 100;
const MAX_BODY = 1000;

type TemplateFormProps = {
  template: MessageTemplate | null;
  onSaved: (template: MessageTemplate) => void;
  onCancel: () => void;
};

function validate(title: string, body: string): string | null {
  if (title.trim().length === 0) return 'أدخل اسماً للقالب';
  if (title.trim().length > MAX_TITLE) return `العنوان يجب ألا يتجاوز ${MAX_TITLE} حرفاً`;
  if (body.trim().length === 0) return 'أدخل نص الرسالة';
  if (body.length > MAX_BODY) return `نص الرسالة يجب ألا يتجاوز ${MAX_BODY} حرفاً`;
  return null;
}

export function TemplateForm({ template, onSaved, onCancel }: TemplateFormProps) {
  const isEdit = template !== null;
  const [title, setTitle] = useState(template?.title ?? '');
  const [body, setBody] = useState(template?.body ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changeField = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    setError(null);
  };

  const handleSave = async () => {
    const validationError = validate(title, body);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const input = { title, body };
      const saved = template
        ? await updateTemplate(template.id, input)
        : await createTemplate(input);
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حفظ القالب. حاول مرة أخرى.');
    } finally {
      setSaving(false);
    }
  };

  const placeholders = extractPlaceholders(body);
  const remaining = MAX_BODY - body.length;

  return (
    <View style={styles.form}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>{isEdit ? 'تعديل القالب' : 'قالب جديد'}</Text>
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

      <Field label="اسم القالب" Icon={Type}>
        <TextInput
          value={title}
          onChangeText={changeField(setTitle)}
          placeholder="مثال: تذكير فاتورة شهرية"
          placeholderTextColor={colors.neutral[400]}
          maxLength={MAX_TITLE}
          editable={!saving}
          style={styles.input}
        />
      </Field>

      <Field label="نص الرسالة" Icon={MessageSquare} hint={`${remaining} حرف متبقٍّ`}>
        <TextInput
          value={body}
          onChangeText={changeField(setBody)}
          placeholder="مرحباً {{name}}، فاتورتك بقيمة {{amount}} ريال. شكراً لك."
          placeholderTextColor={colors.neutral[400]}
          maxLength={MAX_BODY}
          editable={!saving}
          multiline
          textAlignVertical="top"
          style={[styles.input, localStyles.bodyInput]}
        />
      </Field>

      {placeholders.length > 0 ? (
        <View style={localStyles.placeholdersRow}>
          <Text style={localStyles.placeholdersLabel}>المتغيرات:</Text>
          <View style={localStyles.placeholdersList}>
            {placeholders.map((ph) => (
              <View key={ph} style={localStyles.placeholderChip}>
                <Text style={localStyles.placeholderText}>{`{{${ph}}}`}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={isEdit ? 'حفظ التعديلات' : 'حفظ القالب'}
        onPress={handleSave}
        disabled={saving}
        style={({ pressed }) => [styles.saveButton, pressed && styles.pressed, saving && styles.disabled]}
      >
        {saving ? (
          <ActivityIndicator color={colors.neutral[0]} />
        ) : (
          <Text style={styles.saveText}>{isEdit ? 'حفظ التعديلات' : 'حفظ القالب'}</Text>
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
  bodyInput: {
    minHeight: 120,
    lineHeight: 24,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  placeholdersRow: {
    gap: spacing.xs / 2,
  },
  placeholdersLabel: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    lineHeight: 20,
    color: colors.neutral[500],
    writingDirection: 'rtl',
  },
  placeholdersList: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: spacing.xs / 2,
  },
  placeholderChip: {
    backgroundColor: colors.primary[50],
    borderWidth: 1,
    borderColor: colors.primary[200],
    borderRadius: 10,
    paddingHorizontal: spacing.xs / 2,
    paddingVertical: 4,
  },
  placeholderText: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.primary[700],
    writingDirection: 'ltr',
  },
});

import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Eye, EyeOff, FileSpreadsheet, FileUp, MessageSquare, Type, X } from 'lucide-react-native';
import * as DocumentPicker from 'expo-document-picker';
import { Field, formStyles as styles } from '@/components/FormField';
import { DocumentImportModal } from '@/components/DocumentImportModal';
import { createTemplate, updateTemplate, extractPlaceholders, renderMessage } from '@/lib/templates';
import type { MessageTemplate } from '@/lib/templates';
import { colors, fonts, spacing } from '@/constants/theme';

const MAX_TITLE = 100;
const MAX_BODY = 1000;

/** قيم تجريبية افتراضية للمعاينة الحية */
const SAMPLE_VALUES: Record<string, string> = {
  الاسم: 'أحمد محمد',
  اسم_العميل: 'أحمد محمد',
  العميل: 'أحمد محمد',
  المبلغ: '١٥٠.٠٠',
  المبلغ_الإجمالي: '١٨٠.٠٠',
  رقم_الفاتورة: 'INV-١٠٠١',
  رقم_الطلب: 'ORD-٥٥٢',
  التاريخ: new Date().toLocaleDateString('ar-SA'),
  تاريخ_الاستحقاق: new Date().toLocaleDateString('ar-SA'),
  الشركة: 'شركة هدهد',
  الخدمة: 'الاشتراك الشهري',
  العملة: 'ريال',
  name: 'Ahmed Mohammed',
  amount: '150.00',
  date: new Date().toLocaleDateString('en'),
  invoice: 'INV-1001',
};

type TemplateFormProps = {
  template: MessageTemplate | null;
  initialValues?: { title: string; body: string };
  onSaved: (template: MessageTemplate, mapping?: Record<string, string>) => void;
  onCancel: () => void;
};

async function readPickedFile(asset: DocumentPicker.DocumentPickerAsset): Promise<string> {
  if (asset.file) return asset.file.text();
  const response = await fetch(asset.uri);
  return response.text();
}

function validate(title: string, body: string): string | null {
  if (title.trim().length === 0) return 'أدخل اسماً للقالب';
  if (title.trim().length > MAX_TITLE) return `العنوان يجب ألا يتجاوز ${MAX_TITLE} حرفاً`;
  if (body.trim().length === 0) return 'أدخل نص الرسالة';
  if (body.length > MAX_BODY) return `نص الرسالة يجب ألا يتجاوز ${MAX_BODY} حرفاً`;
  return null;
}

export function TemplateForm({ template, initialValues, onSaved, onCancel }: TemplateFormProps) {
  const isEdit = template !== null;
  const [title, setTitle] = useState(template?.title ?? initialValues?.title ?? '');
  const [body, setBody] = useState(template?.body ?? initialValues?.body ?? '');
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [showPreview, setShowPreview] = useState(false);

  const placeholders = extractPlaceholders(body);

  /** نص المعاينة الحية مع تعويض المتغيرات بقيم تجريبية */
  const previewText = renderMessage(body, {
    ...Object.fromEntries(placeholders.map((ph) => [ph, SAMPLE_VALUES[ph] ?? `[${ph}]`])),
  });

  const changeField = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    setError(null);
  };

  const handleImport = async () => {
    setImporting(true);
    setError(null);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/plain', 'text/markdown', 'text/csv'],
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const text = (await readPickedFile(result.assets[0])).trim();
      if (text.length === 0) { setError('الملف فارغ.'); return; }
      if (text.length > MAX_BODY) { setError(`محتوى الملف يتجاوز ${MAX_BODY} حرفاً. اختر ملفاً أقصر.`); return; }
      setBody(text);
    } catch {
      setError('تعذر قراءة الملف. تأكد من أنه ملف نصي (TXT أو CSV أو Markdown).');
    } finally {
      setImporting(false);
    }
  };

  const handleSave = async () => {
    const validationError = validate(title, body);
    if (validationError) { setError(validationError); return; }
    setSaving(true);
    setError(null);
    try {
      const input = { title, body };
      const saved = template ? await updateTemplate(template.id, input) : await createTemplate(input);
      onSaved(saved, columnMapping);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حفظ القالب. حاول مرة أخرى.');
    } finally {
      setSaving(false);
    }
  };

  const handleMappingComplete = (mapping: Record<string, string>) => {
    setColumnMapping(mapping);
    setShowImportModal(false);
  };

  const remaining = MAX_BODY - body.length;

  return (
    <View style={styles.form}>
      {/* رأس النموذج */}
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

      {/* حقل اسم القالب */}
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

      {/* حقل نص الرسالة */}
      <Field label="نص الرسالة" Icon={MessageSquare} hint={`${remaining} حرف متبقٍّ`}>
        {/* زر استيراد نص */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="استيراد نص من ملف"
          onPress={handleImport}
          disabled={saving || importing}
          style={({ pressed }) => [
            localStyles.importButton,
            pressed && styles.pressed,
            (saving || importing) && styles.disabled,
          ]}
        >
          {importing ? (
            <ActivityIndicator size="small" color={colors.primary[700]} />
          ) : (
            <FileUp size={16} color={colors.primary[700]} strokeWidth={2} />
          )}
          <Text style={localStyles.importText}>استيراد نص من ملف</Text>
        </Pressable>

        <TextInput
          value={body}
          onChangeText={changeField(setBody)}
          placeholder="مرحباً {{الاسم}}، فاتورتك بقيمة {{المبلغ}} ريال. شكراً لك."
          placeholderTextColor={colors.neutral[400]}
          maxLength={MAX_BODY}
          editable={!saving}
          multiline
          textAlignVertical="top"
          style={[styles.input, localStyles.bodyInput]}
        />
      </Field>

      {/* معاينة حية للرسالة */}
      {body.trim().length > 0 && (
        <View style={localStyles.previewSection}>
          <Pressable
            onPress={() => setShowPreview((v) => !v)}
            style={localStyles.previewToggle}
          >
            {showPreview ? (
              <EyeOff size={15} color={colors.primary[600]} strokeWidth={2} />
            ) : (
              <Eye size={15} color={colors.primary[600]} strokeWidth={2} />
            )}
            <Text style={localStyles.previewToggleText}>
              {showPreview ? 'إخفاء المعاينة' : 'معاينة الرسالة'}
            </Text>
          </Pressable>
          {showPreview && (
            <View style={localStyles.previewBox}>
              <Text style={localStyles.previewText}>{previewText}</Text>
              <Text style={localStyles.previewHint}>* القيم التجريبية تُستخدم لأغراض المعاينة فقط</Text>
            </View>
          )}
        </View>
      )}

      {/* شرائح المتغيرات المكتشفة */}
      {placeholders.length > 0 ? (
        <View style={localStyles.placeholdersSection}>
          <View style={localStyles.placeholdersRow}>
            <Text style={localStyles.placeholdersLabel}>
              {`المتغيرات المكتشفة (${placeholders.length}):`}
            </Text>
            <View style={localStyles.placeholdersList}>
              {placeholders.map((ph) => (
                <View key={ph} style={localStyles.placeholderChip}>
                  <Text style={localStyles.placeholderText}>{`{{${ph}}}`}</Text>
                  {columnMapping[ph] && (
                    <View style={localStyles.mappedBadge}>
                      <Text style={localStyles.mappedBadgeText}>{columnMapping[ph]}</Text>
                    </View>
                  )}
                </View>
              ))}
            </View>
          </View>

          {/* زر ربط المتغيرات ببيانات */}
          <Pressable
            onPress={() => setShowImportModal(true)}
            style={({ pressed }) => [localStyles.dataImportButton, pressed && styles.pressed]}
          >
            <FileSpreadsheet size={16} color={colors.primary[700]} strokeWidth={2} />
            <Text style={localStyles.importButtonText}>استيراد بيانات وربط المتغيرات</Text>
          </Pressable>
        </View>
      ) : null}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {/* زر الحفظ */}
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

      {/* Modal ربط المتغيرات */}
      <Modal
        visible={showImportModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowImportModal(false)}
      >
        <View style={localStyles.modalOverlay}>
          <DocumentImportModal
            variables={placeholders}
            onMapped={handleMappingComplete}
            onCancel={() => setShowImportModal(false)}
          />
        </View>
      </Modal>
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
  importButton: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    alignSelf: 'flex-end',
    gap: spacing.xs / 2,
    paddingHorizontal: spacing.sm,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.primary[200],
    backgroundColor: colors.primary[50],
  },
  importText: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.primary[700],
    writingDirection: 'rtl',
  },
  bodyInput: {
    minHeight: 120,
    lineHeight: 24,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  /* معاينة الرسالة الحية */
  previewSection: {
    gap: spacing.xs / 2,
  },
  previewToggle: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    alignSelf: 'flex-end',
    gap: 5,
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: colors.primary[50],
    borderWidth: 1,
    borderColor: colors.primary[200],
  },
  previewToggleText: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.primary[700],
    writingDirection: 'rtl',
  },
  previewBox: {
    backgroundColor: colors.neutral[50],
    borderWidth: 1,
    borderColor: colors.neutral[200],
    borderRadius: 14,
    padding: spacing.sm,
    gap: spacing.xs / 2,
  },
  previewText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 24,
    color: colors.neutral[800],
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  previewHint: {
    fontFamily: fonts.regular,
    fontSize: 11,
    color: colors.neutral[400],
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  /* شرائح المتغيرات */
  placeholdersSection: {
    gap: spacing.sm,
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
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.xs / 2,
    backgroundColor: colors.primary[50],
    borderWidth: 1,
    borderColor: colors.primary[200],
    borderRadius: 10,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  placeholderText: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.primary[700],
    writingDirection: 'ltr',
  },
  mappedBadge: {
    backgroundColor: colors.success[100],
    paddingHorizontal: spacing.xs / 2,
    paddingVertical: 2,
    borderRadius: 6,
  },
  mappedBadgeText: {
    fontFamily: fonts.semibold,
    fontSize: 10,
    color: colors.success[700],
  },
  dataImportButton: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs / 2,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.primary[300],
    backgroundColor: colors.primary[50],
  },
  importButtonText: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.primary[700],
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.md,
  },
});

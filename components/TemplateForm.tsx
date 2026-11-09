import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckSquare,
  FileSpreadsheet,
  FileText,
  Plus,
  Save,
  Square,
  Type,
  Upload,
  X,
  MessageSquare,
  Sparkles,
  RotateCw,
} from 'lucide-react-native';
import { useAuth } from '@/lib/auth';
import { pickDocument, parseDocumentFile } from '@/lib/documentParser';
import { parseDocument } from '@/lib/api';
import { createTemplate, updateTemplate, extractPlaceholders, type MessageTemplate } from '@/lib/templates';
import { colors, fonts, spacing } from '@/constants/theme';

const MAX_TITLE = 100;
const MAX_BODY = 1000;

export type ExtractedColumn = {
  name: string;
  rawName: string;
  sampleValue?: string;
  selected: boolean;
};

type TemplateFormProps = {
  template: MessageTemplate | null;
  initialValues?: { title: string; body: string };
  onSaved: (template: MessageTemplate) => void;
  onCancel: () => void;
};

function validate(title: string, body: string): string | null {
  if (title.trim().length === 0) return 'يرجى إدخال اسم للقالب';
  if (title.trim().length > MAX_TITLE) return `اسم القالب يجب ألا يتجاوز ${MAX_TITLE} حرفاً`;
  if (body.trim().length === 0) return 'يرجى كتابة نص الرسالة المخصص للقالب';
  if (body.length > MAX_BODY) return `نص الرسالة يجب ألا يتجاوز ${MAX_BODY} حرفاً`;
  return null;
}

export function TemplateForm({ template, initialValues, onSaved, onCancel }: TemplateFormProps) {
  const { session } = useAuth();
  const isEdit = template !== null;

  // الخطوات: step1_info (الاسم والمستند) | step2_message (نص الرسالة وقائمة الأعمدة المستخرجة)
  const [step, setStep] = useState<'step1_info' | 'step2_message'>(
    isEdit ? 'step2_message' : 'step1_info'
  );

  const [title, setTitle] = useState(template?.title ?? initialValues?.title ?? '');
  const [body, setBody] = useState(template?.body ?? initialValues?.body ?? '');
  const [importedFileName, setImportedFileName] = useState<string | null>(null);
  const [extractedColumns, setExtractedColumns] = useState<ExtractedColumn[]>([]);

  // تتبع موضع المؤشر لإدراج المتغيرات في المكان المناسب
  const [cursorPosition, setCursorPosition] = useState<{ start: number; end: number }>({
    start: (template?.body ?? initialValues?.body ?? '').length,
    end: (template?.body ?? initialValues?.body ?? '').length,
  });

  const [importingDoc, setImportingDoc] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detectedPlaceholders = extractPlaceholders(body);
  const remainingChars = MAX_BODY - body.length;

  // ==========================================
  // استيراد المستند واستخراج عناوين الأعمدة
  // ==========================================
  const handlePickAndExtractDocument = async () => {
    setImportingDoc(true);
    setError(null);

    try {
      const result = await pickDocument();
      if (!result) {
        setImportingDoc(false);
        return;
      }

      setImportedFileName(result.name);

      // إذا لم يكتب المستخدم اسماً للقالب، نقترح اسماً تلقائياً من اسم الملف
      if (!title.trim()) {
        const cleanName = result.name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ');
        setTitle(cleanName);
      }

      const lowerName = result.name.toLowerCase();
      const mimeType = lowerName.endsWith('.pdf')
        ? 'application/pdf'
        : lowerName.endsWith('.xlsx')
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : lowerName.endsWith('.xls')
        ? 'application/vnd.ms-excel'
        : 'text/csv';

      let columns: string[] = [];
      let sampleData: Record<string, string> = {};

      if (lowerName.endsWith('.csv')) {
        const localParsed = await parseDocumentFile(result.uri, result.name);
        columns = localParsed.columns;
        if (localParsed.records?.length) sampleData = localParsed.records[0];
      } else {
        const userId = session?.user?.id || 'default';
        let uploadFile: any;

        if (typeof window !== 'undefined' && typeof File !== 'undefined' && (result as any).file instanceof File) {
          uploadFile = (result as any).file;
        } else if (result.uri.startsWith('data:') && typeof window !== 'undefined' && typeof File !== 'undefined') {
          const response = await fetch(result.uri);
          const blob = await response.blob();
          uploadFile = new File([blob], result.name, { type: blob.type || mimeType });
        } else {
          uploadFile = {
            uri: result.uri,
            name: result.name,
            type: mimeType,
          };
        }

        const parsed = await parseDocument(uploadFile, userId);
        columns = parsed.columns;
        if (parsed.sampleData?.length) sampleData = parsed.sampleData[0];
      }

      if (columns.length === 0) {
        throw new Error('لم يتم العثور على أي أعمدة داخل المستند المختار.');
      }

      // تجهيز الأعمدة المستخرجة كبنود في القائمة
      const newExtracted: ExtractedColumn[] = columns.map((col) => {
        const cleanName = col.trim().replace(/\s+/g, '_');
        return {
          name: cleanName,
          rawName: col,
          sampleValue: sampleData[col] ? String(sampleData[col]).trim() : undefined,
          selected: true,
        };
      });

      setExtractedColumns(newExtracted);

      // بعد استدعاء المستند واستخراج الأعمدة، ننتقل تلقائياً للواجهة الثانية كما طُلب
      setStep('step2_message');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر قراءة المستند واستخراج بياناته.');
    } finally {
      setImportingDoc(false);
    }
  };

  // ==========================================
  // إدراج المتغير في مربع نص الرسالة
  // ==========================================
  const handleInsertColumn = (columnName: string) => {
    const tag = `{{${columnName}}}`;
    const start = cursorPosition.start ?? body.length;
    const end = cursorPosition.end ?? body.length;

    const newBody = body.substring(0, start) + tag + body.substring(end);
    setBody(newBody);

    const nextPos = start + tag.length;
    setCursorPosition({ start: nextPos, end: nextPos });

    // التأكد من أن مربع التحديد لهذا العمود مفعّل
    setExtractedColumns((prev) =>
      prev.map((c) => (c.name === columnName ? { ...c, selected: true } : c))
    );

    setError(null);
  };

  // تبديل اختيار عمود
  const handleToggleColumn = (columnName: string) => {
    setExtractedColumns((prev) =>
      prev.map((c) => (c.name === columnName ? { ...c, selected: !c.selected } : c))
    );
  };

  // حفظ القالب
  const handleSave = async () => {
    const validationError = validate(title, body);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const input = { title: title.trim(), body: body.trim() };
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

  return (
    <View style={localStyles.container}>
      {/* ======================================================== */}
      {/* الواجهة الأولى: اسم القالب وتحته زر استيراد مستند        */}
      {/* ======================================================== */}
      {step === 'step1_info' ? (
        <View style={localStyles.stepContainer}>
          {/* رأس الواجهة الأولى */}
          <View style={localStyles.headerRow}>
            <View style={localStyles.headerTitleWrap}>
              <Text style={localStyles.headerTitle}>
                {isEdit ? 'تعديل اسم القالب والمستند' : 'إنشاء قالب جديد'}
              </Text>
              <Text style={localStyles.stepIndicator}>الخطوة ١ من ٢: إعداد القالب والمستند</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="إغلاق"
              onPress={onCancel}
              style={({ pressed }) => [localStyles.iconButton, pressed && localStyles.pressed]}
            >
              <X size={20} color={colors.neutral[500]} />
            </Pressable>
          </View>

          {/* 1. اسم القالب */}
          <View style={localStyles.fieldWrap}>
            <View style={localStyles.fieldLabelRow}>
              <Type size={16} color={colors.primary[600]} />
              <Text style={localStyles.fieldLabel}>اسم القالب</Text>
            </View>
            <TextInput
              style={localStyles.textInput}
              value={title}
              onChangeText={(txt) => {
                setTitle(txt);
                setError(null);
              }}
              placeholder="مثال: قالب فاتورة كهرباء، إشعار سداد، تذكير مالي..."
              placeholderTextColor={colors.neutral[400]}
              maxLength={MAX_TITLE}
              textAlign="right"
              returnKeyType="next"
            />
          </View>

          {/* 2. تحته مباشرة: زر استيراد مستند اكسل / بي دي اف / سي اس في */}
          <View style={localStyles.fieldWrap}>
            <View style={localStyles.fieldLabelRow}>
              <FileSpreadsheet size={16} color={colors.primary[600]} />
              <Text style={localStyles.fieldLabel}>استيراد مستند البيانات</Text>
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="استيراد مستند إكسل أو بي دي إف أو سي إس في"
              disabled={importingDoc}
              onPress={handlePickAndExtractDocument}
              style={({ pressed }) => [
                localStyles.importDocCard,
                pressed && localStyles.pressed,
                importingDoc && localStyles.disabled,
              ]}
            >
              <View style={localStyles.importDocIconWrap}>
                {importingDoc ? (
                  <ActivityIndicator size="small" color={colors.primary[600]} />
                ) : (
                  <Upload size={24} color={colors.primary[600]} />
                )}
              </View>

              <View style={localStyles.importDocTextWrap}>
                <Text style={localStyles.importDocTitle}>
                  {importingDoc
                    ? 'جاري قراءة واستخراج الأعمدة من المستند...'
                    : 'استيراد مستند (Excel / PDF / CSV)'}
                </Text>
                <Text style={localStyles.importDocSubtitle}>
                  اختر ملفك ليتم استخراج عناوين الأعمدة تلقائياً لاستخدامها في نص الرسالة
                </Text>
                <View style={localStyles.formatsRow}>
                  <View style={localStyles.formatTag}>
                    <Text style={localStyles.formatTagText}>Excel (.xlsx, .xls)</Text>
                  </View>
                  <View style={localStyles.formatTag}>
                    <Text style={localStyles.formatTagText}>PDF (.pdf)</Text>
                  </View>
                  <View style={localStyles.formatTag}>
                    <Text style={localStyles.formatTagText}>CSV (.csv)</Text>
                  </View>
                </View>
              </View>
            </Pressable>
          </View>

          {error ? <Text style={localStyles.errorBanner}>{error}</Text> : null}

          {/* زر المتابعة إلى كتابة نص الرسالة يدوياً */}
          <View style={localStyles.footerNav}>
            <Pressable
              onPress={() => {
                if (!title.trim()) {
                  setError('يرجى كتابة اسم القالب أولاً');
                  return;
                }
                setStep('step2_message');
              }}
              style={({ pressed }) => [localStyles.continueButton, pressed && localStyles.pressed]}
            >
              <Text style={localStyles.continueButtonText}>
                {extractedColumns.length > 0
                  ? 'المتابعة إلى نص الرسالة والأعمدة المستخرجة'
                  : 'أو المتابعة لكتابة نص الرسالة بدون مستند'}
              </Text>
              <ArrowLeft size={16} color={colors.primary[700]} />
            </Pressable>
          </View>
        </View>
      ) : (
        /* ======================================================== */
        /* الواجهة الثانية: مربع نص الرسالة + قائمة الأعمدة المستخرجة */
        /* ======================================================== */
        <View style={localStyles.stepContainer}>
          {/* رأس الواجهة الثانية مع زر الرجوع للواجهة الأولى */}
          <View style={localStyles.headerRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="الرجوع للخطوة الأولى"
              onPress={() => setStep('step1_info')}
              style={({ pressed }) => [localStyles.backButton, pressed && localStyles.pressed]}
            >
              <ArrowRight size={18} color={colors.primary[700]} />
              <Text style={localStyles.backButtonText}>السابق: اسم القالب</Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="إغلاق"
              onPress={onCancel}
              style={({ pressed }) => [localStyles.iconButton, pressed && localStyles.pressed]}
            >
              <X size={20} color={colors.neutral[500]} />
            </Pressable>
          </View>

          {/* ملخص اسم القالب والمستند */}
          <View style={localStyles.summaryBanner}>
            <View style={localStyles.summaryItem}>
              <Type size={14} color={colors.neutral[500]} />
              <Text style={localStyles.summaryLabel}>القالب:</Text>
              <Text style={localStyles.summaryValue} numberOfLines={1}>{title || 'بدون اسم'}</Text>
            </View>
            {importedFileName ? (
              <View style={localStyles.summaryItem}>
                <FileSpreadsheet size={14} color={colors.primary[600]} />
                <Text style={localStyles.summaryLabel}>المستند:</Text>
                <Text style={[localStyles.summaryValue, { color: colors.primary[700] }]} numberOfLines={1}>
                  {importedFileName}
                </Text>
              </View>
            ) : null}
          </View>

          {/* 1. مربع نص الرسالة المخصص للقالب */}
          <View style={localStyles.fieldWrap}>
            <View style={localStyles.messageHeaderRow}>
              <View style={localStyles.fieldLabelRow}>
                <MessageSquare size={16} color={colors.primary[600]} />
                <Text style={localStyles.fieldLabel}>مربع نص الرسالة المخصص للقالب</Text>
              </View>
              <Text style={localStyles.charCount}>
                {remainingChars} حرف متبقٍّ
              </Text>
            </View>

            <TextInput
              style={localStyles.bodyInput}
              value={body}
              onChangeText={(txt) => {
                setBody(txt);
                setError(null);
              }}
              onSelectionChange={(e) => setCursorPosition(e.nativeEvent.selection)}
              placeholder="اكتب نص الرسالة هنا... واضغط زر 'إضافة' من قائمة الأعمدة أدناه لإدراج البنود تلقائياً في موضع المؤشر."
              placeholderTextColor={colors.neutral[400]}
              maxLength={MAX_BODY}
              multiline
              textAlignVertical="top"
              textAlign="right"
            />

            {detectedPlaceholders.length > 0 ? (
              <View style={localStyles.placeholdersRow}>
                <Sparkles size={13} color={colors.primary[600]} />
                <Text style={localStyles.placeholdersSummary}>
                  المتغيرات المضمنة في الرسالة ({detectedPlaceholders.length}):
                </Text>
                <View style={localStyles.chipsContainer}>
                  {detectedPlaceholders.map((ph) => (
                    <View key={ph} style={localStyles.chip}>
                      <Text style={localStyles.chipText}>{`{{${ph}}}`}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}
          </View>

          {/* 2. قائمة عناوين الأعمدة المستخرجة وسردها */}
          <View style={localStyles.columnsSection}>
            <View style={localStyles.columnsSectionHeader}>
              <View style={localStyles.fieldLabelRow}>
                <FileText size={16} color={colors.primary[600]} />
                <Text style={localStyles.fieldLabel}>
                  عناوين الأعمدة المستخرجة من المستند ({extractedColumns.length})
                </Text>
              </View>

              {extractedColumns.length > 0 ? (
                <View style={localStyles.columnActionsRow}>
                  <Pressable
                    onPress={() =>
                      setExtractedColumns((prev) =>
                        prev.map((c) => ({ ...c, selected: true }))
                      )
                    }
                  >
                    <Text style={localStyles.quickActionText}>تحديد الكل</Text>
                  </Pressable>
                  <Text style={localStyles.actionSeparator}>•</Text>
                  <Pressable
                    onPress={() =>
                      setExtractedColumns((prev) =>
                        prev.map((c) => ({ ...c, selected: false }))
                      )
                    }
                  >
                    <Text style={localStyles.quickActionText}>إلغاء التحديد</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>

            {extractedColumns.length > 0 ? (
              <View style={localStyles.columnsList}>
                {extractedColumns.map((col) => (
                  <View
                    key={col.name}
                    style={[
                      localStyles.columnItem,
                      col.selected && localStyles.columnItemSelected,
                    ]}
                  >
                    {/* مربع تحديد أمام كل عنصر خاص بعمود */}
                    <Pressable
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: col.selected }}
                      onPress={() => handleToggleColumn(col.name)}
                      style={localStyles.checkboxTouch}
                    >
                      {col.selected ? (
                        <CheckSquare size={20} color={colors.primary[600]} />
                      ) : (
                        <Square size={20} color={colors.neutral[400]} />
                      )}
                    </Pressable>

                    {/* عنوان العمود وعينة من قيمته */}
                    <View style={localStyles.columnInfo}>
                      <Text style={localStyles.columnTitle}>{col.rawName || col.name}</Text>
                      {col.sampleValue ? (
                        <Text style={localStyles.columnSample} numberOfLines={1}>
                          مثال: {col.sampleValue}
                        </Text>
                      ) : null}
                    </View>

                    {/* خلف كل بند زر باسم "إضافة" لإدراجه فورياً في نص الرسالة */}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`إضافة ${col.name} للرسالة`}
                      onPress={() => handleInsertColumn(col.name)}
                      style={({ pressed }) => [
                        localStyles.insertButton,
                        pressed && localStyles.pressed,
                      ]}
                    >
                      <Plus size={14} color={colors.primary[700]} strokeWidth={2.5} />
                      <Text style={localStyles.insertButtonText}>إضافة</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : (
              <View style={localStyles.noColumnsCard}>
                <Text style={localStyles.noColumnsText}>
                  لم يتم استيراد أي مستند بعد لاستخراج الأعمدة منه.
                </Text>
                <Pressable
                  onPress={handlePickAndExtractDocument}
                  disabled={importingDoc}
                  style={({ pressed }) => [
                    localStyles.miniImportButton,
                    pressed && localStyles.pressed,
                  ]}
                >
                  <Upload size={14} color={colors.primary[700]} />
                  <Text style={localStyles.miniImportButtonText}>
                    استيراد مستند الآن (Excel / PDF / CSV)
                  </Text>
                </Pressable>
              </View>
            )}
          </View>

          {error ? <Text style={localStyles.errorBanner}>{error}</Text> : null}

          {/* 3. زر حفظ في نهاية القائمة ليتم حفظ القالب */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="حفظ القالب"
            disabled={saving}
            onPress={handleSave}
            style={({ pressed }) => [
              localStyles.saveButton,
              pressed && localStyles.pressed,
              saving && localStyles.disabled,
            ]}
          >
            {saving ? (
              <ActivityIndicator color={colors.neutral[0]} />
            ) : (
              <>
                <Save size={18} color={colors.neutral[0]} />
                <Text style={localStyles.saveButtonText}>
                  {isEdit ? 'حفظ التعديلات' : 'حفظ القالب'}
                </Text>
              </>
            )}
          </Pressable>
        </View>
      )}
    </View>
  );
}

const localStyles = StyleSheet.create({
  container: {
    width: '100%',
  },
  stepContainer: {
    gap: spacing.sm,
  },
  headerRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.neutral[200],
  },
  headerTitleWrap: {
    alignItems: 'flex-end',
    gap: 2,
  },
  headerTitle: {
    fontFamily: fonts.bold,
    fontSize: 18,
    color: colors.neutral[900],
    textAlign: 'right',
  },
  stepIndicator: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.primary[600],
    textAlign: 'right',
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.neutral[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButton: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: colors.primary[50],
  },
  backButtonText: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.primary[700],
  },
  summaryBanner: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.neutral[50],
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.neutral[200],
    flexWrap: 'wrap',
  },
  summaryItem: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 4,
  },
  summaryLabel: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.neutral[500],
  },
  summaryValue: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.neutral[900],
  },
  fieldWrap: {
    gap: 6,
  },
  fieldLabelRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
  },
  fieldLabel: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.neutral[800],
    textAlign: 'right',
  },
  textInput: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.neutral[900],
    backgroundColor: colors.neutral[0],
    borderWidth: 1,
    borderColor: colors.neutral[300],
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 48,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  importDocCard: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 12,
    padding: spacing.sm,
    backgroundColor: colors.primary[50],
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.primary[300],
    borderStyle: 'dashed',
  },
  importDocIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primary[100],
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  importDocTextWrap: {
    flex: 1,
    alignItems: 'flex-end',
    gap: 4,
  },
  importDocTitle: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.primary[800],
    textAlign: 'right',
  },
  importDocSubtitle: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.neutral[600],
    textAlign: 'right',
    lineHeight: 18,
  },
  formatsRow: {
    flexDirection: 'row-reverse',
    gap: 6,
    marginTop: 4,
    flexWrap: 'wrap',
  },
  formatTag: {
    backgroundColor: colors.neutral[0],
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.primary[200],
  },
  formatTagText: {
    fontFamily: fonts.semibold,
    fontSize: 10,
    color: colors.primary[700],
  },
  messageHeaderRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  charCount: {
    fontFamily: fonts.regular,
    fontSize: 11,
    color: colors.neutral[400],
  },
  bodyInput: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.neutral[900],
    backgroundColor: colors.neutral[0],
    borderWidth: 1,
    borderColor: colors.neutral[300],
    borderRadius: 12,
    padding: 12,
    minHeight: 130,
    textAlign: 'right',
    writingDirection: 'rtl',
    lineHeight: 22,
  },
  placeholdersRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
    marginTop: 4,
  },
  placeholdersSummary: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    color: colors.neutral[600],
  },
  chipsContainer: {
    flexDirection: 'row-reverse',
    gap: 4,
    flexWrap: 'wrap',
  },
  chip: {
    backgroundColor: colors.primary[100],
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  chipText: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    color: colors.primary[800],
  },
  columnsSection: {
    gap: 8,
    marginTop: 4,
  },
  columnsSectionHeader: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  columnActionsRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
  },
  quickActionText: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.primary[600],
  },
  actionSeparator: {
    color: colors.neutral[300],
    fontSize: 10,
  },
  columnsList: {
    gap: 8,
  },
  columnItem: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    backgroundColor: colors.neutral[0],
    borderWidth: 1,
    borderColor: colors.neutral[200],
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
  },
  columnItemSelected: {
    borderColor: colors.primary[300],
    backgroundColor: colors.primary[50] + '30',
  },
  checkboxTouch: {
    padding: 2,
  },
  columnInfo: {
    flex: 1,
    alignItems: 'flex-end',
    gap: 2,
  },
  columnTitle: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.neutral[900],
    textAlign: 'right',
  },
  columnSample: {
    fontFamily: fonts.regular,
    fontSize: 11,
    color: colors.neutral[500],
    textAlign: 'right',
  },
  insertButton: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: colors.primary[100],
    borderWidth: 1,
    borderColor: colors.primary[300],
  },
  insertButtonText: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: colors.primary[800],
  },
  noColumnsCard: {
    padding: 16,
    backgroundColor: colors.neutral[50],
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.neutral[200],
    alignItems: 'center',
    gap: 8,
  },
  noColumnsText: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.neutral[500],
    textAlign: 'center',
  },
  miniImportButton: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.primary[50],
    borderWidth: 1,
    borderColor: colors.primary[300],
  },
  miniImportButtonText: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.primary[700],
  },
  footerNav: {
    marginTop: spacing.xs,
  },
  continueButton: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 46,
    borderRadius: 12,
    backgroundColor: colors.primary[50],
    borderWidth: 1,
    borderColor: colors.primary[200],
  },
  continueButtonText: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.primary[700],
  },
  saveButton: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
    borderRadius: 12,
    backgroundColor: colors.primary[600],
    marginTop: spacing.xs,
  },
  saveButtonText: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.neutral[0],
  },
  errorBanner: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.error[600],
    backgroundColor: colors.error[50],
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  pressed: {
    opacity: 0.8,
  },
  disabled: {
    opacity: 0.5,
  },
});

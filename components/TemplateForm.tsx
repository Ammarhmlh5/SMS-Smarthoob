import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  ArrowLeft,
  ArrowRight,
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
} from 'lucide-react-native';
import {
  analyzePdfDocument,
  pickDocument,
  parseDocumentFile,
  type DocumentAnalysis,
  type PickedDocument,
} from '@/lib/documentParser';
import { extractPdfRegionValues } from '@/lib/pdfRegions';
import type { PdfTextDocument } from '@/lib/pdfRegions';
import {
  createTemplate,
  extractPlaceholders,
  getTemplateReadiness,
  hasPlaceholder,
  renderTemplatePreview,
  updateTemplate,
  type MessageTemplate,
} from '@/lib/templates';
import { PdfRegionSelector } from '@/components/PdfRegionSelector';
import type { PdfRegion, TemplateVariableMappings } from '@/lib/templateMappings';
import { colors, fonts, spacing } from '@/constants/theme';

const MAX_TITLE = 100;
const MAX_BODY = 1000;

export type ExtractedColumn = {
  name: string;
  rawName: string;
  sampleValue?: string;
  sampleValues: string[];
  selected: boolean;
};

type TemplateFormProps = {
  template: MessageTemplate | null;
  initialValues?: {
    title: string;
    body: string;
    variableMappings?: TemplateVariableMappings;
  };
  onSaved: (template: MessageTemplate) => void;
  onCancel: () => void;
};

type FieldDraft =
  | { type: 'column'; column: string; sampleValues: string[] }
  | { type: 'pdf-region'; region: PdfRegion; sampleValues: string[] };

function normalizeVariableName(value: string): string {
  return value.trim().replace(/\s+/g, '_');
}

function normalizeColumnVariable(value: string): string {
  return normalizeVariableName(value)
    .replace(/[^\w\u0600-\u06FF\u0750-\u077F]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function isValidVariableName(value: string): boolean {
  return /^[\w\u0600-\u06FF\u0750-\u077F]+$/u.test(value);
}

function validate(title: string, body: string): string | null {
  if (title.trim().length === 0) return 'يرجى إدخال اسم للقالب';
  if (title.trim().length > MAX_TITLE) return `اسم القالب يجب ألا يتجاوز ${MAX_TITLE} حرفاً`;
  if (body.trim().length === 0) return 'يرجى كتابة نص الرسالة المخصص للقالب';
  if (body.length > MAX_BODY) return `نص الرسالة يجب ألا يتجاوز ${MAX_BODY} حرفاً`;
  return null;
}

export function TemplateForm({ template, initialValues, onSaved, onCancel }: TemplateFormProps) {
  const isEdit = template !== null;

  // الخطوات: step1_info (الاسم والمستند) | step2_message (نص الرسالة وقائمة الأعمدة المستخرجة)
  const [step, setStep] = useState<'step1_info' | 'step2_message'>(
    isEdit ? 'step2_message' : 'step1_info'
  );

  const [title, setTitle] = useState(template?.title ?? initialValues?.title ?? '');
  const [body, setBody] = useState(template?.body ?? initialValues?.body ?? '');
  const [importedFileName, setImportedFileName] = useState<string | null>(null);
  const [pickedDocument, setPickedDocument] = useState<PickedDocument | null>(null);
  const [pdfTextDocument, setPdfTextDocument] = useState<PdfTextDocument | null>(null);
  const [extractedColumns, setExtractedColumns] = useState<ExtractedColumn[]>([]);
  const [previewColumns, setPreviewColumns] = useState<string[]>([]);
  const [previewRecords, setPreviewRecords] = useState<Record<string, string>[]>([]);
  const [sampleValuesByVariable, setSampleValuesByVariable] = useState<Record<string, string[]>>({});
  const [sampleReadError, setSampleReadError] = useState<string | null>(null);
  const [variableMappings, setVariableMappings] = useState<TemplateVariableMappings>(
    template?.variable_mappings ?? initialValues?.variableMappings ?? {},
  );
  const [fieldDraft, setFieldDraft] = useState<FieldDraft | null>(null);
  const [fieldName, setFieldName] = useState('');
  const [regionSelectorOpen, setRegionSelectorOpen] = useState(false);

  // تتبع موضع المؤشر لإدراج المتغيرات في المكان المناسب
  const [cursorPosition, setCursorPosition] = useState<{ start: number; end: number }>({
    start: (template?.body ?? initialValues?.body ?? '').length,
    end: (template?.body ?? initialValues?.body ?? '').length,
  });
  const [bodyInputHeight, setBodyInputHeight] = useState(130);

  const [importingDoc, setImportingDoc] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detectedPlaceholders = extractPlaceholders(body);
  const readiness = getTemplateReadiness(title, body, variableMappings);
  const previewSamples: Record<string, string | undefined> = {};
  for (const variable of detectedPlaceholders) {
    const mapping = variableMappings[variable];
    if (mapping?.type === 'column') {
      const sampleRecord = previewRecords.find((record) => Boolean(record[mapping.column]?.trim()));
      if (sampleRecord) previewSamples[variable] = sampleRecord[mapping.column].trim();
    } else if (mapping?.type === 'pdf-region') {
      previewSamples[variable] = sampleValuesByVariable[variable]?.find((value) => value.trim());
    }
  }
  const preview = renderTemplatePreview(body, previewSamples);
  const saveButtonLabel = !readiness.ready
    ? 'حفظ كمسودة'
    : isEdit
      ? 'حفظ التعديلات'
      : 'حفظ القالب';
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
      setPickedDocument(result);
      setPdfTextDocument(null);
      setSampleValuesByVariable({});
      setSampleReadError(null);

      // إذا لم يكتب المستخدم اسماً للقالب، نقترح اسماً تلقائياً من اسم الملف
      if (!title.trim()) {
        const cleanName = result.name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ');
        setTitle(cleanName);
      }

      const isPdf = result.name.toLowerCase().endsWith('.pdf');
      let localParsed: DocumentAnalysis;
      if (isPdf) {
        const pdfAnalysis = await analyzePdfDocument(result.uri, result.name, {
          allowTextOnly: true,
        });
        localParsed = pdfAnalysis.analysis;
        setPdfTextDocument(pdfAnalysis.textDocument);

        const pdfMappings = Object.entries(variableMappings).filter(
          ([, mapping]) => mapping.type === 'pdf-region',
        );
        if (pdfMappings.length > 0) {
          try {
            const samples: Record<string, string[]> = {};
            for (const [variable, mapping] of pdfMappings) {
              if (mapping.type === 'pdf-region') {
                samples[variable] = extractPdfRegionValues(pdfAnalysis.textDocument, mapping.region);
              }
            }
            setSampleValuesByVariable(samples);
          } catch (sampleError) {
            setSampleReadError(
              sampleError instanceof Error
                ? `تعذر استخراج عينات مناطق PDF: ${sampleError.message}`
                : 'تعذر استخراج عينات مناطق PDF من المستند المرجعي.',
            );
          }
        }
      } else {
        localParsed = await parseDocumentFile(result.uri, result.name);
      }

      const columns = localParsed.columns;

      if (columns.length === 0 && !isPdf) {
        throw new Error('لم يتم العثور على أي أعمدة داخل المستند المختار.');
      }

      const availableColumns = isPdf
        ? columns.filter((column) =>
            column !== 'رقم الصفحة' &&
            column !== 'النص المستخرج' &&
            localParsed.records?.some((record) => Boolean(record[column]?.trim())),
          )
        : columns;

      const newExtracted: ExtractedColumn[] = availableColumns.map((col) => {
        const cleanName = col.trim().replace(/\s+/g, '_');
        const values = localParsed.records
          ?.map((record) => record[col]?.trim())
          .filter((value): value is string => Boolean(value)) ?? [];
        return {
          name: cleanName,
          rawName: col,
          sampleValue: values[0],
          sampleValues: values,
          selected: true,
        };
      });

      setExtractedColumns(newExtracted);
      setPreviewColumns(localParsed.columns);
      setPreviewRecords(localParsed.records ?? []);

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
  const handleInsertPlaceholder = (variableName: string) => {
    const tag = `{{${variableName}}}`;
    const start = cursorPosition.start ?? body.length;
    const end = cursorPosition.end ?? body.length;

    const newBody = body.substring(0, start) + tag + body.substring(end);
    setBody(newBody);

    const nextPos = start + tag.length;
    setCursorPosition({ start: nextPos, end: nextPos });

    setError(null);
  };

  const handleOpenColumnDraft = (column: ExtractedColumn) => {
    setFieldName(normalizeColumnVariable(column.rawName || column.name));
    setFieldDraft({
      type: 'column',
      column: column.rawName || column.name,
      sampleValues: column.sampleValues,
    });
    setError(null);
  };

  const handleOpenPdfRegionSelector = () => {
    if (!pickedDocument || !pickedDocument.name.toLowerCase().endsWith('.pdf')) {
      setError('استورد ملف PDF أولاً لتحديد بيان من موضعه في الصفحة.');
      return;
    }
    setRegionSelectorOpen(true);
    setError(null);
  };

  const handlePdfRegionSelected = (region: PdfRegion, values: string[]) => {
    setRegionSelectorOpen(false);
    setFieldDraft({ type: 'pdf-region', region, sampleValues: values });
    setFieldName('');
    setSampleReadError(null);
    setError(null);
  };

  const handleChangeDraftColumn = (column: ExtractedColumn) => {
    setFieldDraft({
      type: 'column',
      column: column.rawName || column.name,
      sampleValues: column.sampleValues,
    });
  };

  const handleAddField = () => {
    const variableName = normalizeVariableName(fieldName);
    if (!fieldDraft) {
      setError('حدد بيانًا من المستند أولاً.');
      return;
    }
    if (!isValidVariableName(variableName)) {
      setError('اكتب عنوان البند بحروف أو أرقام أو شرطة سفلية فقط.');
      return;
    }

    setVariableMappings((current) => ({
      ...current,
      [variableName]:
        fieldDraft.type === 'column'
          ? { type: 'column', column: fieldDraft.column }
          : { type: 'pdf-region', region: fieldDraft.region },
    }));
    setSampleValuesByVariable((current) => ({
      ...current,
      [variableName]: fieldDraft.sampleValues,
    }));
    if (!hasPlaceholder(body, variableName)) {
      handleInsertPlaceholder(variableName);
    }
    setFieldDraft(null);
    setFieldName('');
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
    if (saving) return;
    const validationError = validate(title, body);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const activeVariables = new Set(extractPlaceholders(body));
      const activeMappings = Object.fromEntries(
        Object.entries(variableMappings).filter(([name]) => activeVariables.has(name)),
      );
      const input = {
        title: title.trim(),
        body: body.trim(),
        variable_mappings: activeMappings,
      };
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
              <Text accessibilityLiveRegion="polite" style={localStyles.stepIndicator}>
                الخطوة ١ من ٢: إعداد القالب والمستند
              </Text>
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
              <Text style={localStyles.fieldLabel}>اسم القالب *</Text>
            </View>
            <TextInput
              style={localStyles.textInput}
              accessibilityLabel="اسم القالب، حقل مطلوب"
              accessibilityHint="استخدم اسماً يميّز القالب عند اختياره لاحقاً"
              value={title}
              onChangeText={(txt) => {
                setTitle(txt);
                setError(null);
              }}
              placeholder="مثال: قالب فاتورة كهرباء، إشعار سداد، تذكير مالي..."
              placeholderTextColor={colors.neutral[600]}
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
              accessibilityHint="سيتم استخراج أسماء الأعمدة والانتقال تلقائياً إلى نص الرسالة"
              accessibilityState={{ disabled: importingDoc, busy: importingDoc }}
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

          {error ? (
            <Text accessibilityRole="alert" style={localStyles.errorBanner}>{error}</Text>
          ) : null}

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
              accessibilityRole="button"
              accessibilityLabel={
                extractedColumns.length > 0
                  ? 'المتابعة إلى نص الرسالة والأعمدة المستخرجة'
                  : 'المتابعة لكتابة نص الرسالة'
              }
              style={({ pressed }) => [localStyles.continueButton, pressed && localStyles.pressed]}
            >
              <Text style={localStyles.continueButtonText}>
                {extractedColumns.length > 0
                  ? 'المتابعة إلى نص الرسالة والأعمدة المستخرجة'
                  : 'المتابعة لكتابة نص الرسالة'}
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

            <Text accessibilityLiveRegion="polite" style={localStyles.stepIndicator}>
              الخطوة ٢ من ٢: نص الرسالة والمتغيرات
            </Text>

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
              <Text style={localStyles.summaryValue} selectable>{title || 'بدون اسم'}</Text>
            </View>
            {importedFileName ? (
              <View style={localStyles.summaryItem}>
                <FileSpreadsheet size={14} color={colors.primary[600]} />
                <Text style={localStyles.summaryLabel}>المستند:</Text>
                <Text style={[localStyles.summaryValue, { color: colors.primary[700] }]} selectable>
                  {importedFileName}
                </Text>
              </View>
            ) : null}
          </View>

          {pickedDocument?.name.toLowerCase().endsWith('.pdf') ? (
            <View style={localStyles.documentPreviewSection}>
              <View style={localStyles.documentPreviewCopy}>
                <Text style={localStyles.documentPreviewTitle}>معاينة PDF الأصلية</Text>
                <Text style={localStyles.documentPreviewHint}>
                  الحقول المستخرجة آليًا اقتراحات قابلة للتصحيح. حدّد قيمة من الصفحة، أو اختر نمط الصفوف لاستخراج عمود متكرر من جدول.
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="معاينة PDF وإضافة بند من الصفحة"
                onPress={handleOpenPdfRegionSelector}
                style={({ pressed }) => [
                  localStyles.previewButton,
                  pressed && localStyles.pressed,
                ]}
              >
                <FileText size={17} color={colors.neutral[0]} />
                <Text style={localStyles.previewButtonText}>معاينة PDF وإضافة بند</Text>
              </Pressable>
            </View>
          ) : pickedDocument ? (
            <View style={localStyles.documentPreviewSection}>
              <Text style={localStyles.documentPreviewTitle}>معاينة البيانات المستخرجة</Text>
              <Text style={localStyles.documentPreviewHint}>
                عينة من أول ثلاثة سجلات. مرّر أفقيًا لرؤية بقية الأعمدة.
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator
                contentContainerStyle={localStyles.previewTable}
              >
                <View>
                  <View style={localStyles.previewTableRow}>
                    {previewColumns.map((column) => (
                      <Text key={column} style={localStyles.previewTableHeader} numberOfLines={2}>
                        {column}
                      </Text>
                    ))}
                  </View>
                  {previewRecords.slice(0, 3).map((record, rowIndex) => (
                    <View key={`preview-${rowIndex}`} style={localStyles.previewTableRow}>
                      {previewColumns.map((column) => (
                        <Text
                          key={`${rowIndex}-${column}`}
                          style={localStyles.previewTableCell}
                          numberOfLines={2}
                        >
                          {record[column] || '—'}
                        </Text>
                      ))}
                    </View>
                  ))}
                </View>
              </ScrollView>
            </View>
          ) : null}

          {fieldDraft ? (
            <View style={localStyles.fieldDraft}>
              <View style={localStyles.fieldDraftHeader}>
                <Text accessibilityRole="header" style={localStyles.fieldDraftTitle}>
                  إضافة بند إلى القالب
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="إلغاء إعداد البند"
                  onPress={() => setFieldDraft(null)}
                  style={localStyles.draftCloseButton}
                >
                  <X size={16} color={colors.neutral[600]} />
                </Pressable>
              </View>
              <Text style={localStyles.fieldDraftLabel}>عنوان البند داخل الرسالة</Text>
              <TextInput
                accessibilityLabel="عنوان المتغير في الرسالة"
                value={fieldName}
                onChangeText={(value) => {
                  setFieldName(value);
                  setError(null);
                }}
                placeholder="مثال: اسم_المشترك أو المبلغ"
                placeholderTextColor={colors.neutral[500]}
                maxLength={60}
                autoCapitalize="none"
                style={localStyles.textInput}
                textAlign="right"
              />
              {fieldDraft.type === 'column' ? (
                <View style={localStyles.sourcePicker}>
                  <Text style={localStyles.fieldDraftLabel}>بيان المصدر</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={localStyles.sourceOptions}
                  >
                    {extractedColumns.map((column) => {
                      const sourceName = column.rawName || column.name;
                      const selected = fieldDraft.column === sourceName;
                      return (
                        <Pressable
                          key={column.name}
                          accessibilityRole="button"
                          accessibilityLabel={`مصدر البيان: ${sourceName}`}
                          accessibilityState={{ selected }}
                          onPress={() => handleChangeDraftColumn(column)}
                          style={[
                            localStyles.sourceOption,
                            selected && localStyles.sourceOptionSelected,
                          ]}
                        >
                          <Text
                            style={[
                              localStyles.sourceOptionText,
                              selected && localStyles.sourceOptionTextSelected,
                            ]}
                          >
                            {sourceName}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>
              ) : (
                <View style={localStyles.regionDraftInfo}>
                  <Text style={localStyles.fieldDraftLabel}>البيان المحدد من الصفحة</Text>
                  <Text style={localStyles.regionDraftValue} numberOfLines={3}>
                    {fieldDraft.sampleValues.find(Boolean) || 'لا توجد قيمة'}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="تغيير موضع البيان في ملف PDF"
                    accessibilityHint="افتح معاينة PDF لاختيار منطقة أخرى"
                    onPress={handleOpenPdfRegionSelector}
                    style={localStyles.changeRegionButton}
                  >
                    <Text style={localStyles.changeRegionText}>تغيير موضع البيان</Text>
                  </Pressable>
                </View>
              )}
              <View style={localStyles.sampleValues}>
                <Text style={localStyles.fieldDraftLabel}>
                  {fieldDraft.type === 'pdf-region'
                    ? fieldDraft.region.scope === 'rows'
                      ? 'عينة من قيم الصفوف المحددة'
                      : 'عينة من قيم البيان في المستند'
                    : 'عينة من قيم هذا البيان'}
                </Text>
                <Text style={localStyles.sampleValuesText} numberOfLines={3}>
                  {fieldDraft.sampleValues.filter(Boolean).slice(0, 3).join(' · ') || 'لا توجد قيم للعرض'}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="إضافة البند إلى الرسالة"
                onPress={handleAddField}
                style={({ pressed }) => [
                  localStyles.addFieldButton,
                  pressed && localStyles.pressed,
                ]}
              >
                <Plus size={17} color={colors.neutral[0]} />
                <Text style={localStyles.addFieldButtonText}>
                  إضافة {normalizeVariableName(fieldName) ? `{{${normalizeVariableName(fieldName)}}}` : 'البند'}
                </Text>
              </Pressable>
            </View>
          ) : null}

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
              style={[localStyles.bodyInput, { height: bodyInputHeight }]}
              accessibilityLabel="نص الرسالة المخصص للقالب، حقل مطلوب"
              accessibilityHint="اكتب الرسالة وأدخل المتغيرات من قائمة الأعمدة"
              value={body}
              onChangeText={(txt) => {
                setBody(txt);
                setError(null);
              }}
              onSelectionChange={(e) => setCursorPosition(e.nativeEvent.selection)}
              onContentSizeChange={(event) => {
                const nextHeight = Math.min(
                  360,
                  Math.max(130, event.nativeEvent.contentSize.height + 24),
                );
                setBodyInputHeight(nextHeight);
              }}
              placeholder="اكتب نص الرسالة، أو أضف بندًا من المستند لإدراج متغير في موضع المؤشر."
              placeholderTextColor={colors.neutral[600]}
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

          <View
            style={[
              localStyles.reviewPanel,
              readiness.ready ? localStyles.reviewPanelReady : localStyles.reviewPanelIncomplete,
            ]}
          >
            <View style={localStyles.reviewHeader}>
              {readiness.ready ? (
                <CheckSquare size={18} color={colors.success[700]} />
              ) : (
                <FileText size={18} color={colors.warning[600]} />
              )}
              <View style={localStyles.reviewHeaderCopy}>
                <Text
                  style={[
                    localStyles.reviewTitle,
                    readiness.ready ? localStyles.reviewTitleReady : localStyles.reviewTitleIncomplete,
                  ]}
                >
                  {readiness.ready ? 'القالب مكتمل' : 'القالب غير مكتمل'}
                </Text>
                <Text style={localStyles.reviewHint}>
                  {readiness.missingVariables.length > 0
                    ? 'اربط المتغيرات التالية بمصادر بيانات قبل اعتباره جاهزًا.'
                    : readiness.ready
                      ? 'تم تحديد مصدر لكل متغير مستخدم في نص الرسالة.'
                      : 'أدخل اسم القالب ونص الرسالة لإكمال الإعداد.'}
                </Text>
              </View>
            </View>

            {readiness.missingVariables.length > 0 ? (
              <View style={localStyles.missingVariables}>
                {readiness.missingVariables.map((variable) => (
                  <View key={variable} style={localStyles.missingVariableChip}>
                    <Text style={localStyles.missingVariableText}>{`{{${variable}}}`}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            <View style={localStyles.reviewDivider} />
            <Text accessibilityRole="header" style={localStyles.previewTitle}>
              معاينة رسالة بعينة البيانات
            </Text>
            <Text style={localStyles.previewMessage} selectable>
              {preview.message || 'اكتب نص الرسالة لعرض المعاينة.'}
            </Text>
            {sampleReadError ? (
              <Text accessibilityRole="alert" style={localStyles.previewNotice}>
                {sampleReadError}
              </Text>
            ) : null}
            {preview.missingVariables.length > 0 ? (
              <Text accessibilityLiveRegion="polite" style={localStyles.previewNotice}>
                لا تتوفر عينة لبعض المتغيرات: {preview.missingVariables.map((name) => `{{${name}}}`).join('، ')}.
                حدّد مستندًا مرجعيًا أو أعد اختيار مصدر البيان لعرض القيم.
              </Text>
            ) : null}
          </View>

          {/* 2. قائمة عناوين الأعمدة المستخرجة وسردها */}
          <View style={localStyles.columnsSection}>
            <View style={localStyles.columnsSectionHeader}>
              <View style={localStyles.fieldLabelRow}>
                <FileText size={16} color={colors.primary[600]} />
                <Text accessibilityRole="header" style={localStyles.fieldLabel}>
                  {pickedDocument?.name.toLowerCase().endsWith('.pdf')
                    ? `حقول PDF المقترحة آليًا (${extractedColumns.length})`
                    : `عناوين الأعمدة المستخرجة من المستند (${extractedColumns.length})`}
                </Text>
              </View>

              {extractedColumns.length > 0 ? (
                <View style={localStyles.columnActionsRow}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="تحديد كل الأعمدة المستخرجة"
                    style={localStyles.quickActionButton}
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
                    accessibilityRole="button"
                    accessibilityLabel="إلغاء تحديد كل الأعمدة المستخرجة"
                    style={localStyles.quickActionButton}
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
                      accessibilityLabel={`تحديد العمود ${col.rawName || col.name}`}
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
                      {col.sampleValues.length > 0 ? (
                        <View style={localStyles.columnValues}>
                          {col.sampleValues.slice(0, 2).map((value, valueIndex) => (
                            <View
                              key={`${col.name}-${valueIndex}-${value}`}
                              style={localStyles.columnValueChip}
                            >
                              <Text style={localStyles.columnValueText} selectable numberOfLines={2}>
                                {value}
                              </Text>
                            </View>
                          ))}
                        </View>
                      ) : null}
                    </View>

                    {/* خلف كل بند زر باسم "إضافة" لإدراجه فورياً في نص الرسالة */}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`إعداد بند من ${col.rawName || col.name}`}
                      accessibilityState={{ disabled: !col.selected }}
                      disabled={!col.selected}
                      onPress={() => handleOpenColumnDraft(col)}
                      style={({ pressed }) => [
                        localStyles.insertButton,
                        pressed && localStyles.pressed,
                        !col.selected && localStyles.disabled,
                      ]}
                    >
                      <Plus size={14} color={colors.primary[700]} strokeWidth={2.5} />
                      <Text style={localStyles.insertButtonText}>إضافة بند</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : (
              <View style={localStyles.noColumnsCard}>
                <Text style={localStyles.noColumnsText}>
                  {pickedDocument?.name.toLowerCase().endsWith('.pdf')
                    ? 'لم تُستخرج أعمدة تلقائية من ملف PDF. أضف البيانات من مواضعها في معاينة PDF أعلاه.'
                    : pickedDocument
                      ? 'لم تُستخرج أعمدة من المستند المختار. اختر ملفًا يحتوي على عناوين أعمدة وصفوف بيانات.'
                      : 'لم يتم استيراد أي مستند بعد لاستخراج الأعمدة منه.'}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={pickedDocument
                    ? 'اختيار مستند آخر لاستخراج الأعمدة'
                    : 'استيراد مستند لاستخراج الأعمدة'}
                  onPress={handlePickAndExtractDocument}
                  disabled={importingDoc}
                  style={({ pressed }) => [
                    localStyles.miniImportButton,
                    pressed && localStyles.pressed,
                  ]}
                >
                  <Upload size={14} color={colors.primary[700]} />
                  <Text style={localStyles.miniImportButtonText}>
                    {pickedDocument
                      ? 'اختيار مستند آخر'
                      : 'استيراد مستند الآن (Excel / PDF / CSV)'}
                  </Text>
                </Pressable>
              </View>
            )}
          </View>

          {error ? (
            <Text accessibilityRole="alert" style={localStyles.errorBanner}>{error}</Text>
          ) : null}

          {/* 3. زر حفظ في نهاية القائمة ليتم حفظ القالب */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={saveButtonLabel}
            accessibilityState={{ disabled: saving, busy: saving }}
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
                  {saveButtonLabel}
                </Text>
              </>
            )}
          </Pressable>
        </View>
      )}
      {pickedDocument?.name.toLowerCase().endsWith('.pdf') ? (
        <PdfRegionSelector
          uri={pickedDocument.uri}
          visible={regionSelectorOpen}
          document={pdfTextDocument ?? undefined}
          onCancel={() => setRegionSelectorOpen(false)}
          onSelect={handlePdfRegionSelected}
        />
      ) : null}
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
    flex: 1,
    textAlign: 'center',
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 18,
    backgroundColor: colors.neutral[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButton: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    minHeight: 44,
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
  documentPreviewSection: {
    gap: spacing.xs,
    padding: spacing.sm,
    borderRadius: 14,
    backgroundColor: colors.neutral[50],
    borderWidth: 1,
    borderColor: colors.neutral[200],
  },
  documentPreviewCopy: {
    gap: 3,
    alignItems: 'flex-end',
  },
  documentPreviewTitle: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.neutral[900],
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  documentPreviewHint: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.neutral[600],
    lineHeight: 18,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  previewButton: {
    minHeight: 44,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: spacing.sm,
    borderRadius: 11,
    backgroundColor: colors.primary[700],
  },
  previewButtonText: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: colors.neutral[0],
    writingDirection: 'rtl',
  },
  previewTable: {
    paddingTop: spacing.xs,
  },
  previewTableRow: {
    flexDirection: 'row-reverse',
  },
  previewTableHeader: {
    width: 148,
    minHeight: 42,
    padding: 7,
    fontFamily: fonts.semibold,
    fontSize: 11,
    color: colors.primary[800],
    textAlign: 'right',
    writingDirection: 'rtl',
    backgroundColor: colors.primary[100],
    borderWidth: 1,
    borderColor: colors.primary[200],
  },
  previewTableCell: {
    width: 148,
    minHeight: 38,
    padding: 7,
    fontFamily: fonts.regular,
    fontSize: 11,
    lineHeight: 16,
    color: colors.neutral[700],
    textAlign: 'right',
    writingDirection: 'rtl',
    backgroundColor: colors.neutral[0],
    borderWidth: 1,
    borderColor: colors.neutral[200],
  },
  fieldDraft: {
    gap: spacing.xs,
    padding: spacing.sm,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.primary[300],
    backgroundColor: colors.primary[50],
  },
  fieldDraftHeader: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  fieldDraftTitle: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.neutral[900],
    writingDirection: 'rtl',
  },
  draftCloseButton: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.neutral[0],
  },
  fieldDraftLabel: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.neutral[700],
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  sourcePicker: {
    gap: 5,
  },
  sourceOptions: {
    flexDirection: 'row-reverse',
    gap: 6,
  },
  sourceOption: {
    minHeight: 38,
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: colors.neutral[300],
    backgroundColor: colors.neutral[0],
  },
  sourceOptionSelected: {
    borderColor: colors.primary[600],
    backgroundColor: colors.primary[100],
  },
  sourceOptionText: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.neutral[700],
    writingDirection: 'rtl',
  },
  sourceOptionTextSelected: {
    color: colors.primary[800],
  },
  regionDraftInfo: {
    gap: 5,
    padding: spacing.xs,
    borderRadius: 10,
    backgroundColor: colors.neutral[0],
  },
  regionDraftValue: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.neutral[900],
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  changeRegionButton: {
    alignSelf: 'flex-start',
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  changeRegionText: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.primary[700],
    writingDirection: 'rtl',
  },
  sampleValues: {
    gap: 4,
  },
  sampleValuesText: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 18,
    color: colors.neutral[700],
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  addFieldButton: {
    minHeight: 46,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 11,
    backgroundColor: colors.primary[700],
  },
  addFieldButtonText: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: colors.neutral[0],
    writingDirection: 'rtl',
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
    color: colors.neutral[600],
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
  reviewPanel: {
    gap: spacing.xs,
    padding: spacing.sm,
    borderWidth: 1,
    borderRadius: 12,
    backgroundColor: colors.neutral[0],
  },
  reviewPanelReady: {
    borderColor: colors.success[500],
  },
  reviewPanelIncomplete: {
    borderColor: colors.warning[500],
  },
  reviewHeader: {
    flexDirection: 'row-reverse',
    alignItems: 'flex-start',
    gap: spacing.xs,
  },
  reviewHeaderCopy: {
    flex: 1,
    alignItems: 'flex-end',
    gap: 2,
  },
  reviewTitle: {
    fontFamily: fonts.bold,
    fontSize: 14,
    textAlign: 'right',
  },
  reviewTitleReady: {
    color: colors.success[700],
  },
  reviewTitleIncomplete: {
    color: colors.neutral[800],
  },
  reviewHint: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 18,
    color: colors.neutral[700],
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  missingVariables: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: 6,
  },
  missingVariableChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 7,
    backgroundColor: colors.warning[500] + '1A',
  },
  missingVariableText: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.neutral[800],
    writingDirection: 'ltr',
  },
  reviewDivider: {
    height: 1,
    backgroundColor: colors.neutral[200],
    marginVertical: 2,
  },
  previewTitle: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.neutral[800],
    textAlign: 'right',
  },
  previewMessage: {
    padding: spacing.xs,
    borderRadius: 8,
    backgroundColor: colors.neutral[50],
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 23,
    color: colors.neutral[800],
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  previewNotice: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    lineHeight: 18,
    color: colors.neutral[700],
    textAlign: 'right',
    writingDirection: 'rtl',
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
  quickActionButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
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
  columnValues: {
    width: '100%',
    gap: 4,
  },
  columnValueChip: {
    width: '100%',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: colors.neutral[50],
    borderWidth: 1,
    borderColor: colors.neutral[200],
  },
  columnValueText: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 18,
    color: colors.neutral[700],
    textAlign: 'right',
  },
  checkboxTouch: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
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
    minHeight: 44,
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
    minHeight: 44,
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

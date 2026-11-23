/**
 * Document Import Modal
 * Allows user to import a document and map variables to columns
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  ArrowRight,
  Check,
  FileSpreadsheet,
  MessageSquareText,
  Phone,
  RefreshCw,
  Send,
  Upload,
  X,
} from 'lucide-react-native';
import { colors, fonts, spacing } from '@/constants/theme';
import { 
  pickDocument, 
  parseDocumentFile,
  pickedDocumentToUploadFile,
  suggestMapping, 
  type DocumentAnalysis,
} from '@/lib/documentParser';
import { parseDocument } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  isPreparedMessageColumn,
  type DocumentMessageMode,
  type DocumentRecipientMapping,
} from '@/lib/documentRecipients';

const DEFAULT_CONNECTION_REQUIRED_MESSAGE = 'اضبط خدمة الإرسال الافتراضية من الإعدادات أولاً.';

type Props = {
  variables: string[];
  showRecipientMapping?: boolean;
  recipientMessageMode?: DocumentMessageMode;
  sharedFile?: { uri: string; name: string } | null;
  onMapped: (
    mapping: Record<string, string>,
    document?: DocumentAnalysis,
    recipientMapping?: DocumentRecipientMapping,
  ) => void;
  onDirectSend?: (
    mapping: Record<string, string>,
    document: DocumentAnalysis,
    recipientMapping: DocumentRecipientMapping,
  ) => Promise<void>;
  canSendDirectly?: boolean;
  directSendProgress?: { sent: number; failed: number; processed: number; total: number };
  onOpenSettings?: () => void;
  onCancel: () => void;
};

export function DocumentImportModal({
  variables,
  showRecipientMapping = false,
  recipientMessageMode,
  sharedFile,
  onMapped,
  onDirectSend,
  canSendDirectly = false,
  directSendProgress,
  onOpenSettings,
  onCancel,
}: Props) {
  const { session } = useAuth();
  const [step, setStep] = useState<'pick' | 'mapping' | 'done'>('pick');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [document, setDocument] = useState<DocumentAnalysis | null>(null);
  const [manualMappings, setManualMappings] = useState<Record<string, string>>({});
  const [phoneColumn, setPhoneColumn] = useState('');
  const [messageColumn, setMessageColumn] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const directRecordsListRef = useRef<FlatList<Record<string, string>> | null>(null);

  const processDocument = useCallback(async (result: { uri: string; name: string }) => {
    setLoading(true);
    setError(null);

    try {
      if (!/\.(csv|xlsx?|pdf)$/i.test(result.name)) {
        throw new Error('نوع الملف غير مدعوم. اختر ملف CSV أو Excel أو PDF.');
      }

      let transformedDoc: DocumentAnalysis | null = null;

      // Determine MIME type
      const lowerName = result.name.toLowerCase();
      const isCsv = lowerName.endsWith('.csv');
      const mimeType = lowerName.endsWith('.pdf')
        ? 'application/pdf'
        : lowerName.endsWith('.xlsx')
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : lowerName.endsWith('.xls')
        ? 'application/vnd.ms-excel'
        : 'text/csv';

      if (isCsv) {
        transformedDoc = await parseDocumentFile(result.uri, result.name);
      } else {
        const userId = session?.user?.id || 'default';
        const uploadFile = await pickedDocumentToUploadFile(result, mimeType);

        const parsed = await parseDocument(uploadFile, userId);
        const records = parsed.records;
        if (!records?.length || records.length !== parsed.rowCount) {
          throw new Error('لم يُرجع محلل المستند جميع الصفوف؛ لا يمكن إنشاء حملة من عينة جزئية. أعد تصدير الملف بصيغة CSV لمعالجته على الهاتف.');
        }

        transformedDoc = {
          columns: parsed.columns,
          columnInfo: {},
          rowCount: parsed.rowCount,
          fileName: result.name,
          records,
          suggestedPhoneColumn: parsed.suggestedPhoneColumn,
          suggestedNameColumn: parsed.suggestedNameColumn,
        };

        if (parsed.detectedColumns) {
          for (const col of parsed.detectedColumns) {
            transformedDoc.columnInfo[col.name] = {
              name: col.name,
              type: col.type as any,
              confidence: col.confidence,
              sampleValues: (parsed.sampleData ?? [])
                .map((record) => record[col.name])
                .filter((value): value is string => typeof value === 'string')
                .slice(0, 5),
            };
          }
        }
      }

      if (transformedDoc) {
        const suggested = suggestMapping(variables, transformedDoc.columns, transformedDoc.columnInfo);
        const initial: Record<string, string> = {};
        for (const mapping of suggested) {
          initial[mapping.variable] = mapping.column;
        }
        setManualMappings(initial);
        setPhoneColumn(
          transformedDoc.suggestedPhoneColumn ||
          transformedDoc.columns.find((column) => transformedDoc.columnInfo[column]?.type === 'phone') ||
          transformedDoc.columns.find((column) => /هاتف|جوال|phone|mobile|واتساب/i.test(column)) ||
          '',
        );
        const preparedMessageColumn = transformedDoc.columns.find(isPreparedMessageColumn) || '';
        setMessageColumn(preparedMessageColumn);
        setDocument(transformedDoc);
        setStep('mapping');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحليل الملف');
    } finally {
      setLoading(false);
    }
  }, [session, variables]);

  useEffect(() => {
    if (!sharedFile) return;
    const timer = setTimeout(() => {
      void processDocument(sharedFile);
    }, 0);
    return () => clearTimeout(timer);
  }, [processDocument, sharedFile]);

  useEffect(() => {
    directRecordsListRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [document]);

  const handlePickDocument = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await pickDocument();
      if (result) await processDocument(result);
      else setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر اختيار الملف');
      setLoading(false);
    }
  };

  const handleMappingChange = (variable: string, column: string) => {
    setManualMappings(prev => ({
      ...prev,
      [variable]: column
    }));
    setError(null);
  };

  const getValidatedMappings = () => {
    if (!document) {
      setError('اختر مستنداً للمتابعة.');
      return null;
    }

    const hasPreparedMessage = document?.columns.some(isPreparedMessageColumn) ?? false;
    const usesPreparedMessage = recipientMessageMode
      ? recipientMessageMode === 'prepared'
      : hasPreparedMessage;
    if (showRecipientMapping && !phoneColumn) {
      setError('حدد عمود رقم الهاتف للمتابعة.');
      return null;
    }
    if (showRecipientMapping && usesPreparedMessage && !messageColumn) {
      setError('حدد عمود نص الرسالة الجاهزة للمتابعة.');
      return null;
    }
    if (showRecipientMapping && usesPreparedMessage && phoneColumn === messageColumn) {
      setError('اختر عموداً مختلفاً لرقم الهاتف ونص الرسالة.');
      return null;
    }
    if (showRecipientMapping && !usesPreparedMessage && variables.some((variable) => !manualMappings[variable])) {
      setError('اربط جميع متغيرات القالب بأعمدة المستند للمتابعة.');
      return null;
    }

    const validMappings: Record<string, string> = {};
    for (const [variable, column] of Object.entries(manualMappings)) {
      if (column) {
        validMappings[variable] = column;
      }
    }
    setError(null);
    return {
      validMappings,
      recipientMapping: showRecipientMapping
        ? {
            phoneColumn,
            messageColumn: usesPreparedMessage ? messageColumn : undefined,
            ...(recipientMessageMode ? { messageMode: recipientMessageMode } : {}),
          }
        : undefined,
    };
  };

  const handleConfirm = () => {
    const mappings = getValidatedMappings();
    if (!mappings || !document) return;
    onMapped(
      mappings.validMappings,
      document,
      mappings.recipientMapping,
    );
    setStep('done');
  };

  const handleDirectSend = async () => {
    if (!onDirectSend || !document || submittingRef.current) return;
    if (!canSendDirectly) {
      setError(DEFAULT_CONNECTION_REQUIRED_MESSAGE);
      return;
    }

    const mappings = getValidatedMappings();
    if (!mappings?.recipientMapping) return;

    submittingRef.current = true;
    setSubmitting(true);
    try {
      await onDirectSend(mappings.validMappings, document, mappings.recipientMapping);
      setStep('done');
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'تعذر تنفيذ الإرسال المباشر.');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const renderColumnSelector = (
    selectedColumn: string,
    onSelect: (column: string) => void,
    accessibilityLabel: string,
  ) => (
    <View style={styles.columnPicker}>
      <ScrollView
        key={`${accessibilityLabel}-${document?.fileName ?? ''}`}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.columnPickerContent}
      >
        {document?.columns.map((column) => (
          <Pressable
            key={column}
            accessibilityRole="button"
            accessibilityLabel={`${accessibilityLabel}: ${column}`}
            accessibilityState={{ selected: selectedColumn === column }}
            disabled={submitting}
            onPress={() => {
              onSelect(column);
              setError(null);
            }}
            style={({ pressed }) => [
              styles.columnOption,
              selectedColumn === column && styles.columnOptionSelected,
              pressed && styles.pressed,
            ]}
          >
            <Text
              style={[
                styles.columnOptionText,
                selectedColumn === column && styles.columnOptionTextSelected,
              ]}
            >
              {column}
            </Text>
          </Pressable>
          ))}
      </ScrollView>
    </View>
  );

  const renderPickStep = () => (
    <View style={styles.stepContent}>
      <View style={styles.iconCircle}>
        <Upload size={32} color={colors.primary[600]} strokeWidth={2} />
      </View>
      
      <Text style={styles.stepTitle}>استيراد مستند</Text>
      <Text style={styles.stepDescription}>
        اختر ملف CSV، Excel، أو PDF يحتوي على بيانات العملاء
      </Text>

      {error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <Pressable
        onPress={handlePickDocument}
        disabled={loading}
        style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
      >
        {loading ? (
          <ActivityIndicator color={colors.neutral[0]} />
        ) : (
          <>
            <FileSpreadsheet size={18} color={colors.neutral[0]} strokeWidth={2} />
            <Text style={styles.primaryButtonText}>اختيار ملف</Text>
          </>
        )}
      </Pressable>

      <Pressable onPress={onCancel} style={styles.cancelButton}>
        <Text style={styles.cancelButtonText}>إلغاء</Text>
      </Pressable>
    </View>
  );

  const renderMappingStep = () => {
    if (!document) return null;

    const sampleRecords = document.records?.slice(0, 2) ?? [];
    const allRecords = document.records ?? [];
    const hasPreparedMessage = document.columns.some(isPreparedMessageColumn);
    const usesPreparedMessage = recipientMessageMode
      ? recipientMessageMode === 'prepared'
      : hasPreparedMessage;
    const hasNoVariableMappings = Object.values(manualMappings).every((column) => !column);
    const variableMappings = (
      <View style={styles.variablesSection}>
        <Text style={styles.sectionTitle}>أعمدة متغيرات القالب</Text>
        <Text style={styles.sectionHint}>
          {showRecipientMapping
            ? 'ستُنشأ رسالة لكل صف باستخدام القالب المختار وأعمدة المستند'
            : 'حدد العمود المناسب لكل متغير من ملف البيانات'}
        </Text>
        {variables.map((variable) => (
          <View key={variable} style={styles.mappingRow}>
            <View style={styles.variableInfo}>
              <Text style={styles.variableName}>{`{{${variable}}}`}</Text>
              <Text style={styles.variableHint}>
                {document.columnInfo[manualMappings[variable]]?.type === 'unknown'
                  ? 'لم يتم الربط'
                  : document.columnInfo[manualMappings[variable]]?.type}
              </Text>
            </View>
            <View style={styles.arrowContainer}>
              <ArrowRight size={16} color={colors.neutral[400]} strokeWidth={2} />
            </View>
            <View style={styles.columnPicker}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.columnPickerContent}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`إلغاء ربط ${variable}`}
                  accessibilityState={{ selected: !manualMappings[variable] }}
                  onPress={() => handleMappingChange(variable, '')}
                  style={({ pressed }) => [
                    styles.columnOption,
                    !manualMappings[variable] && styles.columnOptionSelected,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[
                    styles.columnOptionText,
                    !manualMappings[variable] && styles.columnOptionTextSelected,
                  ]}>
                    -
                  </Text>
                </Pressable>
                {document.columns.map((column) => (
                  <Pressable
                    key={column}
                    accessibilityRole="button"
                    accessibilityLabel={`ربط ${variable} بعمود ${column}`}
                    accessibilityState={{ selected: manualMappings[variable] === column }}
                    onPress={() => handleMappingChange(variable, column)}
                    style={({ pressed }) => [
                      styles.columnOption,
                      manualMappings[variable] === column && styles.columnOptionSelected,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={[
                      styles.columnOptionText,
                      manualMappings[variable] === column && styles.columnOptionTextSelected,
                    ]}>
                      {column}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          </View>
        ))}
      </View>
    );

    const documentInfo = (
      <View style={[styles.docInfo, onDirectSend && styles.directDocInfo]}>
        <FileSpreadsheet size={20} color={colors.primary[600]} strokeWidth={2} />
        <Text style={styles.docName} numberOfLines={1}>{document.fileName}</Text>
        <View style={styles.docStats}>
          <Text style={styles.docStatText}>{document.columns.length} عمود</Text>
          <Text style={styles.docStatDot}>•</Text>
          <Text style={styles.docStatText}>{document.rowCount} صف</Text>
        </View>
      </View>
    );

    const mappingFields = showRecipientMapping ? (
      <View style={[styles.requiredMappings, onDirectSend && styles.directRequiredMappings]}>
        <View style={[styles.requiredMapping, onDirectSend && styles.directRequiredMapping]}>
          <View style={styles.requiredMappingHeading}>
            <Phone size={16} color={colors.primary[700]} strokeWidth={2} />
            <Text style={styles.sectionTitle}>عمود رقم الهاتف</Text>
          </View>
          {!onDirectSend ? (
            <Text style={styles.sectionHint}>اختر العمود الذي يحتوي على أرقام المستلمين</Text>
          ) : null}
          {renderColumnSelector(
            phoneColumn,
            setPhoneColumn,
            'رقم الهاتف',
          )}
        </View>

        {usesPreparedMessage ? (
          <View style={[styles.requiredMapping, onDirectSend && styles.directRequiredMapping]}>
            <View style={styles.requiredMappingHeading}>
              <MessageSquareText size={16} color={colors.primary[700]} strokeWidth={2} />
              <Text style={styles.sectionTitle}>عمود نص الرسالة الجاهزة</Text>
            </View>
            {!onDirectSend ? (
              <Text style={styles.sectionHint}>سيتم استخدام نص الرسالة من كل صف في الملف</Text>
            ) : null}
            {renderColumnSelector(
              messageColumn,
              setMessageColumn,
              'نص الرسالة',
            )}
          </View>
        ) : variables.length > 0 ? (
          variableMappings
        ) : null}
      </View>
    ) : variables.length > 0 ? variableMappings : null;

    if (onDirectSend) {
      return (
        <View style={styles.directMappingLayout}>
          <View style={styles.directListHeader}>
            {documentInfo}
            {mappingFields}
            <View style={styles.previewSection}>
              <Text style={styles.sectionTitle}>
                معاينة البيانات · الإرسال يشمل جميع الصفوف ({document.rowCount})
              </Text>
            </View>
          </View>
          <FlatList
            ref={directRecordsListRef}
            data={allRecords}
            keyExtractor={(_, index) => `${document.fileName}-${index}`}
            style={styles.directRecordsList}
            contentContainerStyle={styles.directRecordsContent}
            keyboardShouldPersistTaps="handled"
            initialNumToRender={8}
            maxToRenderPerBatch={10}
            windowSize={5}
            renderItem={({ item, index }) => (
              <View style={styles.recordCard}>
                <Text style={styles.recordNumber}>صف {index + 1}</Text>
                <View style={styles.recordFields}>
                  {document.columns.map((column) => {
                    const selectedColumn = column === phoneColumn || column === messageColumn;
                    return (
                      <View
                        key={column}
                        style={[
                          styles.recordField,
                          selectedColumn && styles.recordFieldSelected,
                        ]}
                      >
                        <Text style={styles.recordFieldLabel}>{column}</Text>
                        <Text
                          style={[
                            styles.recordFieldValue,
                            column === phoneColumn && styles.phoneRecordValue,
                          ]}
                        >
                          {item[column] || '—'}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            )}
            ListEmptyComponent={
              <Text style={styles.emptyPreview}>لا يحتوي المستند على صفوف لإرسالها.</Text>
            }
          />

          <View style={styles.directFooter}>
            {error ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
                {error === DEFAULT_CONNECTION_REQUIRED_MESSAGE && onOpenSettings ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={onOpenSettings}
                    disabled={submitting}
                    style={styles.gatewaySettingsButton}
                  >
                    <Text style={styles.gatewaySettingsButtonText}>فتح الإعدادات</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            <View style={styles.directButtonRow}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setStep('pick')}
                disabled={submitting}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  styles.directActionButton,
                  pressed && styles.pressed,
                  submitting && styles.disabled,
                ]}
              >
                <RefreshCw size={16} color={colors.primary[700]} strokeWidth={2} />
                <Text style={styles.secondaryButtonText}>ملف آخر</Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`إرسال مباشر إلى ${document.rowCount} مستلم`}
                onPress={() => void handleDirectSend()}
                disabled={submitting || allRecords.length === 0}
                style={({ pressed }) => [
                  styles.primaryButton,
                  styles.directActionButton,
                  pressed && styles.pressed,
                  (submitting || allRecords.length === 0) && styles.disabled,
                ]}
              >
                {submitting ? (
                  <ActivityIndicator color={colors.neutral[0]} />
                ) : (
                  <Send size={18} color={colors.neutral[0]} />
                )}
                <Text style={styles.directButtonText}>
                  {submitting
                    ? `جاري الإرسال ${directSendProgress?.processed ?? 0}/${directSendProgress?.total ?? document.rowCount}`
                    : `إرسال مباشر (${document.rowCount})`}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      );
    }

    return (
      <ScrollView style={styles.mappingScroll} showsVerticalScrollIndicator={false}>
        <View style={styles.stepContent}>
          {documentInfo}
          {mappingFields}

          <View style={styles.previewSection}>
            <Text style={styles.sectionTitle}>معاينة البيانات</Text>
            <View style={styles.previewTable}>
              <View style={styles.previewHeader}>
                {document.columns.slice(0, 4).map((col) => (
                  <View key={col} style={styles.previewHeaderCell}>
                    <Text style={styles.previewHeaderText} numberOfLines={1}>{col}</Text>
                  </View>
                ))}
              </View>
              {sampleRecords.slice(0, 2).map((record, idx) => (
                <View key={idx} style={styles.previewRow}>
                  {document.columns.slice(0, 4).map((col) => (
                    <View key={col} style={styles.previewCell}>
                      <Text style={styles.previewCellText} numberOfLines={1}>
                        {record[col] || '-'}
                      </Text>
                    </View>
                  ))}
                </View>
              ))}
            </View>
          </View>

          {error && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <View style={styles.buttonRow}>
            <Pressable
              accessibilityRole="button"
              onPress={() => setStep('pick')}
              disabled={submitting}
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
            >
              <RefreshCw size={16} color={colors.primary[700]} strokeWidth={2} />
              <Text style={styles.secondaryButtonText}>ملف آخر</Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              onPress={handleConfirm}
              disabled={submitting ||
                (!showRecipientMapping &&
                  variables.length > 0 &&
                  hasNoVariableMappings &&
                  !hasPreparedMessage)}
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && styles.pressed,
                (submitting ||
                  (!showRecipientMapping &&
                    variables.length > 0 &&
                    hasNoVariableMappings &&
                    !hasPreparedMessage)) &&
                  styles.disabled,
              ]}
            >
              <Check size={18} color={colors.neutral[0]} strokeWidth={2} />
              <Text style={styles.primaryButtonText}>تأكيد الربط</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    );
  };

  return (
    <View style={[styles.container, onDirectSend && styles.directContainer]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>
          {step === 'pick' ? 'استيراد بيانات' : 
           step === 'mapping' ? (onDirectSend ? 'معاينة وإرسال الرسائل' : 'ربط المتغيرات') : 'تم بنجاح'}
        </Text>
        <Pressable onPress={onCancel} disabled={submitting} style={styles.closeButton}>
          <X size={20} color={colors.neutral[500]} strokeWidth={2} />
        </Pressable>
      </View>

      {step === 'pick' && renderPickStep()}
      {step === 'mapping' && renderMappingStep()}
      {step === 'done' && (
        <View style={styles.stepContent}>
          <View style={styles.successIcon}>
            <Check size={40} color={colors.success[600]} strokeWidth={3} />
          </View>
          <Text style={styles.successText}>
            {onDirectSend ? 'اكتمل الإرسال المباشر' : 'تم ربط المتغيرات بنجاح'}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={onCancel}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
          >
            <Text style={styles.primaryButtonText}>تم</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.neutral[0],
    borderRadius: 24,
    maxHeight: '90%',
    width: '100%',
    maxWidth: 400,
    overflow: 'hidden',
  },
  directContainer: {
    height: '100%',
    maxHeight: '100%',
    maxWidth: 960,
  },
  header: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.neutral[100],
  },
  headerTitle: {
    fontFamily: fonts.bold,
    fontSize: 18,
    color: colors.neutral[900],
  },
  closeButton: {
    padding: spacing.xs,
  },
  stepContent: {
    padding: spacing.md,
    alignItems: 'center',
    gap: spacing.md,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepTitle: {
    fontFamily: fonts.bold,
    fontSize: 20,
    color: colors.neutral[900],
    textAlign: 'center',
  },
  stepDescription: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.neutral[500],
    textAlign: 'center',
    lineHeight: 22,
  },
  errorBox: {
    backgroundColor: colors.error[50],
    padding: spacing.sm,
    borderRadius: 12,
    width: '100%',
  },
  errorText: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.error[600],
    textAlign: 'center',
  },
  primaryButton: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs / 2,
    height: 48,
    paddingHorizontal: spacing.md,
    borderRadius: 12,
    backgroundColor: colors.primary[700],
    minWidth: 140,
  },
  primaryButtonText: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.neutral[0],
  },
  secondaryButton: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs / 2,
    height: 48,
    paddingHorizontal: spacing.md,
    borderRadius: 12,
    backgroundColor: colors.primary[50],
    borderWidth: 1,
    borderColor: colors.primary[200],
    minWidth: 120,
  },
  secondaryButtonText: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.primary[700],
  },
  cancelButton: {
    paddingVertical: spacing.sm,
  },
  cancelButtonText: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.neutral[500],
  },
  pressed: {
    opacity: 0.8,
  },
  disabled: {
    opacity: 0.5,
  },
  
  mappingScroll: {
    maxHeight: 500,
  },
  directMappingLayout: {
    flex: 1,
    flexBasis: 0,
    flexShrink: 1,
    minHeight: 0,
    overflow: 'hidden',
  },
  directRecordsList: {
    flex: 1,
    flexBasis: 0,
    flexShrink: 1,
    minHeight: 100,
  },
  directRecordsContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.xs,
  },
  directListHeader: {
    flexShrink: 0,
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  directDocInfo: {
    paddingVertical: spacing.xs,
  },
  directFooter: {
    flexShrink: 0,
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  recordCard: {
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.neutral[200],
    borderRadius: 12,
    backgroundColor: colors.neutral[0],
    padding: spacing.sm,
  },
  recordNumber: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.neutral[500],
    textAlign: 'right',
  },
  recordFields: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  recordField: {
    flexBasis: '48%',
    flexGrow: 1,
    minWidth: 120,
    gap: 3,
    borderWidth: 1,
    borderColor: colors.neutral[100],
    borderRadius: 8,
    backgroundColor: colors.neutral[50],
    padding: spacing.xs,
  },
  recordFieldSelected: {
    borderColor: colors.primary[200],
    backgroundColor: colors.primary[50],
  },
  recordFieldLabel: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    color: colors.primary[700],
    textAlign: 'right',
  },
  recordFieldValue: {
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 19,
    color: colors.neutral[800],
    textAlign: 'right',
  },
  phoneRecordValue: {
    writingDirection: 'ltr',
    textAlign: 'left',
  },
  emptyPreview: {
    padding: spacing.md,
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.neutral[600],
    textAlign: 'center',
  },
  docInfo: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.primary[50],
    padding: spacing.sm,
    borderRadius: 12,
    width: '100%',
  },
  docName: {
    flex: 1,
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.neutral[900],
    textAlign: 'right',
  },
  docStats: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.xs / 2,
  },
  docStatText: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.neutral[500],
  },
  docStatDot: {
    color: colors.neutral[400],
  },
  variablesSection: {
    width: '100%',
    gap: spacing.sm,
  },
  requiredMappings: {
    width: '100%',
    gap: spacing.md,
  },
  directRequiredMappings: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  directRequiredMapping: {
    width: 'auto',
    flexBasis: 300,
    flexGrow: 1,
    minWidth: 250,
    flexDirection: 'row-reverse',
    alignItems: 'center',
  },
  requiredMapping: {
    width: '100%',
    gap: spacing.xs,
  },
  requiredMappingHeading: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.xs,
  },
  sectionTitle: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.neutral[900],
    textAlign: 'right',
  },
  sectionHint: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.neutral[500],
    textAlign: 'right',
    marginBottom: spacing.xs,
  },
  mappingRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.neutral[50],
    padding: spacing.sm,
    borderRadius: 12,
  },
  variableInfo: {
    minWidth: 80,
    alignItems: 'flex-end',
  },
  variableName: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.primary[700],
    writingDirection: 'ltr',
  },
  variableHint: {
    fontFamily: fonts.regular,
    fontSize: 11,
    color: colors.neutral[500],
  },
  arrowContainer: {
    paddingHorizontal: spacing.xs / 2,
  },
  columnPicker: {
    flex: 1,
  },
  columnPickerContent: {
    gap: spacing.xs / 2,
    paddingVertical: 2,
  },
  columnOption: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs / 2,
    borderRadius: 8,
    backgroundColor: colors.neutral[0],
    borderWidth: 1,
    borderColor: colors.neutral[200],
  },
  columnOptionSelected: {
    backgroundColor: colors.primary[600],
    borderColor: colors.primary[600],
  },
  columnOptionText: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.neutral[700],
  },
  columnOptionTextSelected: {
    color: colors.neutral[0],
  },
  
  previewSection: {
    width: '100%',
    gap: spacing.sm,
  },
  directButtonRow: {
    flexDirection: 'row-reverse',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  directActionButton: {
    flex: 1,
    height: 40,
    minWidth: 0,
  },
  directButtonText: {
    flexShrink: 1,
    fontFamily: fonts.bold,
    fontSize: 13,
    color: colors.neutral[0],
    textAlign: 'center',
  },
  gatewaySettingsButton: {
    alignSelf: 'flex-end',
    paddingVertical: spacing.xs,
  },
  gatewaySettingsButtonText: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.primary[700],
  },
  previewTable: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.neutral[200],
    overflow: 'hidden',
  },
  previewHeader: {
    flexDirection: 'row-reverse',
    backgroundColor: colors.neutral[100],
    borderBottomWidth: 1,
    borderBottomColor: colors.neutral[200],
  },
  previewHeaderCell: {
    flex: 1,
    padding: spacing.xs,
    minWidth: 60,
  },
  previewHeaderText: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    color: colors.neutral[700],
    textAlign: 'center',
  },
  previewRow: {
    flexDirection: 'row-reverse',
    borderBottomWidth: 1,
    borderBottomColor: colors.neutral[100],
  },
  previewCell: {
    flex: 1,
    padding: spacing.xs,
    minWidth: 60,
  },
  previewCellText: {
    fontFamily: fonts.regular,
    fontSize: 11,
    color: colors.neutral[600],
    textAlign: 'center',
  },
  
  buttonRow: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    gap: spacing.sm,
    width: '100%',
    marginTop: spacing.sm,
  },
  
  successIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.success[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  successText: {
    fontFamily: fonts.bold,
    fontSize: 18,
    color: colors.success[700],
  },
});
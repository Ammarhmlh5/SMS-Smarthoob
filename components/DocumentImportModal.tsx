/**
 * Document Import Modal
 * Allows user to import a document and map variables to columns
 */

import { useState, useEffect } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { FileSpreadsheet, Upload, Check, X, ArrowRight, RefreshCw } from 'lucide-react-native';
import { colors, fonts, spacing } from '@/constants/theme';
import { 
  pickDocument, 
  parseDocumentFile,
  suggestMapping, 
  getSampleRecords,
  type DocumentAnalysis, 
  type VariableMapping 
} from '@/lib/documentParser';
import { parseDocument } from '@/lib/api';
import { useAuth } from '@/lib/auth';

type Props = {
  variables: string[];
  onMapped: (mapping: Record<string, string>, document?: DocumentAnalysis) => void;
  onCancel: () => void;
};

export function DocumentImportModal({ variables, onMapped, onCancel }: Props) {
  const { session } = useAuth();
  const [step, setStep] = useState<'pick' | 'mapping' | 'done'>('pick');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [document, setDocument] = useState<DocumentAnalysis | null>(null);
  const [mappings, setMappings] = useState<VariableMapping[]>([]);
  const [manualMappings, setManualMappings] = useState<Record<string, string>>({});

  useEffect(() => {
    if (document) {
      const suggested = suggestMapping(variables, document.columns, document.columnInfo);
      setMappings(suggested);
      
      const initial: Record<string, string> = {};
      for (const m of suggested) {
        initial[m.variable] = m.column;
      }
      setManualMappings(initial);
    }
  }, [document, variables]);

  const handlePickDocument = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const result = await pickDocument();
      if (!result) {
        setLoading(false);
        return;
      }

      const userId = session?.user?.id || 'default';
      let transformedDoc: DocumentAnalysis | null = null;

      // Determine MIME type
      const lowerName = result.name.toLowerCase();
      const mimeType = lowerName.endsWith('.pdf')
        ? 'application/pdf'
        : lowerName.endsWith('.xlsx')
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : lowerName.endsWith('.xls')
        ? 'application/vnd.ms-excel'
        : 'text/csv';

      // Attempt parsing via backend API first (supports PDF, Excel, AI analysis)
      try {
        let uploadFile: any;
        if (typeof window !== 'undefined' && typeof File !== 'undefined' && (result as any).file instanceof File) {
          uploadFile = (result as any).file;
        } else if (result.uri.startsWith('data:') && typeof window !== 'undefined' && typeof File !== 'undefined') {
          const response = await fetch(result.uri);
          const blob = await response.blob();
          uploadFile = new File([blob], result.name, { type: blob.type || mimeType });
        } else {
          // Native FormData payload
          uploadFile = {
            uri: result.uri,
            name: result.name,
            type: mimeType,
          };
        }

        const parsed = await parseDocument(uploadFile, userId);

        transformedDoc = {
          columns: parsed.columns,
          columnInfo: {},
          rowCount: parsed.rowCount,
          fileName: result.name,
          records: parsed.sampleData,
          suggestedPhoneColumn: parsed.suggestedPhoneColumn,
          suggestedNameColumn: parsed.suggestedNameColumn,
        };

        if (parsed.detectedColumns) {
          for (const col of parsed.detectedColumns) {
            transformedDoc.columnInfo[col.name] = {
              name: col.name,
              type: col.type as any,
              confidence: col.confidence,
              sampleValues: [],
            };
          }
        }
      } catch (apiErr) {
        console.warn('Backend parsing unavailable, checking local parser:', apiErr);
        // Fallback to local file parser if it's CSV
        if (!lowerName.endsWith('.pdf') && !lowerName.endsWith('.xlsx') && !lowerName.endsWith('.xls')) {
          transformedDoc = await parseDocumentFile(result.uri, result.name);
        } else {
          throw apiErr;
        }
      }

      if (transformedDoc) {
        setDocument(transformedDoc);
        setStep('mapping');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحليل الملف');
    } finally {
      setLoading(false);
    }
  };

  const handleMappingChange = (variable: string, column: string) => {
    setManualMappings(prev => ({
      ...prev,
      [variable]: column
    }));
  };

  const handleConfirm = () => {
    const validMappings: Record<string, string> = {};
    for (const [variable, column] of Object.entries(manualMappings)) {
      if (column) {
        validMappings[variable] = column;
      }
    }
    onMapped(validMappings, document || undefined);
    setStep('done');
  };

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

    const sampleRecords = getSampleRecords(document.columns, document.columnInfo, 2);

    return (
      <ScrollView style={styles.mappingScroll} showsVerticalScrollIndicator={false}>
        <View style={styles.stepContent}>
          <View style={styles.docInfo}>
            <FileSpreadsheet size={20} color={colors.primary[600]} strokeWidth={2} />
            <Text style={styles.docName} numberOfLines={1}>{document.fileName}</Text>
            <View style={styles.docStats}>
              <Text style={styles.docStatText}>{document.columns.length} عمود</Text>
              <Text style={styles.docStatDot}>•</Text>
              <Text style={styles.docStatText}>{document.rowCount} صف</Text>
            </View>
          </View>

          <View style={styles.variablesSection}>
            <Text style={styles.sectionTitle}>ربط المتغيرات بالأعمدة</Text>
            <Text style={styles.sectionHint}>
              حدد العمود المناسب لكل متغير من ملف البيانات
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
                      onPress={() => handleMappingChange(variable, '')}
                      style={({ pressed }) => [
                        styles.columnOption,
                        !manualMappings[variable] && styles.columnOptionSelected,
                        pressed && styles.pressed
                      ]}
                    >
                      <Text style={[
                        styles.columnOptionText,
                        !manualMappings[variable] && styles.columnOptionTextSelected
                      ]}>
                        -
                      </Text>
                    </Pressable>
                    
                    {document.columns.map((col) => (
                      <Pressable
                        key={col}
                        onPress={() => handleMappingChange(variable, col)}
                        style={({ pressed }) => [
                          styles.columnOption,
                          manualMappings[variable] === col && styles.columnOptionSelected,
                          pressed && styles.pressed
                        ]}
                      >
                        <Text style={[
                          styles.columnOptionText,
                          manualMappings[variable] === col && styles.columnOptionTextSelected
                        ]}>
                          {col}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              </View>
            ))}
          </View>

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
              onPress={() => setStep('pick')}
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
            >
              <RefreshCw size={16} color={colors.primary[700]} strokeWidth={2} />
              <Text style={styles.secondaryButtonText}>ملف آخر</Text>
            </Pressable>

            <Pressable
              onPress={handleConfirm}
              disabled={Object.values(manualMappings).filter(Boolean).length === 0}
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && styles.pressed,
                Object.values(manualMappings).filter(Boolean).length === 0 && styles.disabled
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
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>
          {step === 'pick' ? 'استيراد بيانات' : 
           step === 'mapping' ? 'ربط المتغيرات' : 'تم بنجاح'}
        </Text>
        <Pressable onPress={onCancel} style={styles.closeButton}>
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
          <Text style={styles.successText}>تم ربط المتغيرات بنجاح</Text>
          <Pressable onPress={onCancel} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
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
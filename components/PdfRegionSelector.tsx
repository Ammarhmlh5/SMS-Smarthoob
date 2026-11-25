import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ArrowLeft, ArrowRight, Check, X } from 'lucide-react-native';
import { PdfPagePreview } from '@/components/PdfPagePreview';
import {
  extractPdfRegionRows,
  extractPdfRegionValues,
  loadPdfTextDocument,
} from '@/lib/pdfRegions';
import type { PdfTextDocument, PdfTextPage } from '@/lib/pdfRegions';
import { pdfRegionFromTextBounds } from '@/lib/pdfRegionGeometry';
import type { PdfRegion } from '@/lib/templateMappings';
import { colors, fonts, spacing } from '@/constants/theme';

type Props = {
  uri: string;
  visible: boolean;
  document?: PdfTextDocument;
  onCancel: () => void;
  onSelect: (region: PdfRegion, values: string[]) => void;
};

export function PdfRegionSelector({ uri, visible, document, onCancel, onSelect }: Props) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onCancel}
    >
      {visible ? (
        <PdfRegionSelectorContent
          key={uri}
          uri={uri}
          initialDocument={document}
          onCancel={onCancel}
          onSelect={onSelect}
        />
      ) : null}
    </Modal>
  );
}

function PdfRegionSelectorContent({
  uri,
  initialDocument,
  onCancel,
  onSelect,
}: Omit<Props, 'visible' | 'document'> & { initialDocument?: PdfTextDocument }) {
  const [loadedDocument, setLoadedDocument] = useState<PdfTextDocument | null>(null);
  const document = initialDocument ?? loadedDocument;
  const [page, setPage] = useState(1);
  const [region, setRegion] = useState<PdfRegion | null>(null);
  const [scope, setScope] = useState<'page' | 'rows'>('page');
  const [rowRangeSelected, setRowRangeSelected] = useState(false);
  const [values, setValues] = useState<string[]>([]);
  const [loading, setLoading] = useState(!initialDocument);
  const [error, setError] = useState<string | null>(null);
  const [textChoicesVisible, setTextChoicesVisible] = useState(false);
  const [textSearch, setTextSearch] = useState('');

  useEffect(() => {
    if (initialDocument) return;
    let active = true;
    void loadPdfTextDocument(uri)
      .then((loaded) => {
        if (active) setLoadedDocument(loaded);
      })
      .catch((loadError) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'تعذر قراءة ملف PDF.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [initialDocument, uri]);

  const pageSizes = useMemo(() => document?.pages ?? [], [document]);
  const rowValues = useMemo(
    () => document && region?.scope === 'rows'
      ? extractPdfRegionRows(document, region)
      : [],
    [document, region],
  );
  const pageValues = region?.scope === 'rows'
    ? rowValues
        .filter((row) => row.pageNumber === page && row.value.trim())
        .slice(0, 3)
        .map((row) => row.value)
        .join(' · ')
    : region
      ? values[page - 1] ?? ''
      : '';
  const validPageValues = region?.scope === 'rows'
    ? rowValues.filter((row) => row.value.trim()).length
    : values.filter((value) => value.length > 0).length;
  const hasText = pageSizes.some((pdfPage) => pdfPage.items.length > 0);
  const currentPage = pageSizes[page - 1];
  const isLoading = loading && !document;
  const canSelect = Boolean(
    region &&
    !isLoading &&
    (region.scope === 'rows'
      ? rowRangeSelected && validPageValues > 0
      : pageValues.trim()),
  );
  const matchingTextItems = useMemo(() => {
    const query = textSearch.trim().toLocaleLowerCase();
    return (currentPage?.items ?? []).filter((item) =>
      !query || item.text.toLocaleLowerCase().includes(query),
    );
  }, [currentPage, textSearch]);
  const visibleTextItems = matchingTextItems.slice(0, 50);

  const handleRegionSelected = (nextRegion: PdfRegion, isRowRange = true) => {
    if (!document) return;
    const selectedRegion = { ...nextRegion, scope };
    const extractedValues = extractPdfRegionValues(document, selectedRegion);
    setRegion(selectedRegion);
    setValues(extractedValues);
    setRowRangeSelected(scope !== 'rows' || isRowRange);
    setError(
      extractedValues.some(Boolean)
        ? null
        : 'لم يُعثر على نص داخل المنطقة. وسّع التحديد حول البيان وحاول مجددًا.',
    );
  };

  const handleSelect = () => {
    if (!region || !canSelect) return;
    onSelect(region, values);
  };

  const handleTextItemSelected = (item: PdfTextPage['items'][number]) => {
    if (!currentPage) return;
    handleRegionSelected(pdfRegionFromTextBounds(currentPage, item, scope), false);
    setTextChoicesVisible(false);
  };

  return (
    <View style={styles.screen}>
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text accessibilityRole="header" style={styles.heading}>حدد البيان من المستند</Text>
            <Text style={styles.subheading}>
              اسحب حول قيمة البيان، أو اختر نصًا من القائمة لبديل أسهل للوصول.
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="إغلاق معاينة المستند"
            onPress={onCancel}
            style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
          >
            <X size={20} color={colors.neutral[600]} />
          </Pressable>
        </View>

        {isLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator
              accessibilityLabel="جاري تجهيز معاينة المستند"
              color={colors.primary[700]}
            />
            <Text accessibilityLiveRegion="polite" style={styles.statusText}>
              جاري تجهيز معاينة المستند…
            </Text>
          </View>
        ) : error && !document ? (
          <View style={styles.centered}>
            <Text accessibilityRole="alert" style={styles.errorText}>{error}</Text>
          </View>
        ) : document ? (
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.scopeSelector}>
              <Text style={styles.scopeHeading}>طريقة استخراج البيان</Text>
              <View style={styles.scopeOptions}>
                {([
                  ['page', 'قيمة لكل صفحة'],
                  ['rows', 'قيمة لكل صف'],
                ] as const).map(([value, label]) => (
                  <Pressable
                    key={value}
                    accessibilityRole="button"
                    accessibilityLabel={label}
                    accessibilityState={{ selected: scope === value }}
                    onPress={() => {
                      setScope(value);
                      setRegion(null);
                      setRowRangeSelected(false);
                      setValues([]);
                      setError(null);
                    }}
                    style={[
                      styles.scopeOption,
                      scope === value && styles.scopeOptionSelected,
                    ]}
                  >
                    <Text
                      style={[
                        styles.scopeOptionText,
                        scope === value && styles.scopeOptionTextSelected,
                      ]}
                    >
                      {label}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.scopeHint}>
                {scope === 'rows'
                  ? 'اسحب من أول صف بيانات إلى آخره لتحديد العمود. اختيار نص من القائمة يحدد موضعه فقط ولا يعتمد نطاق الصفوف.'
                  : 'حدد البيان داخل الصفحة؛ تُستخرج قيمة واحدة من الموضع نفسه في كل صفحة.'}
              </Text>
            </View>

            <View style={styles.pageToolbar}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="الصفحة السابقة"
                accessibilityState={{ disabled: page <= 1 }}
                disabled={page <= 1}
                onPress={() => setPage((current) => Math.max(1, current - 1))}
                style={({ pressed }) => [
                  styles.pageButton,
                  page <= 1 && styles.disabled,
                  pressed && styles.pressed,
                ]}
              >
                <ArrowRight size={17} color={colors.primary[700]} />
              </Pressable>
              <Text
                accessibilityLabel={`صفحة ${page} من ${pageSizes.length}`}
                style={styles.pageCounter}
              >
                صفحة {page} من {pageSizes.length}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="الصفحة التالية"
                accessibilityState={{ disabled: page >= pageSizes.length }}
                disabled={page >= pageSizes.length}
                onPress={() => setPage((current) => Math.min(pageSizes.length, current + 1))}
                style={({ pressed }) => [
                  styles.pageButton,
                  page >= pageSizes.length && styles.disabled,
                  pressed && styles.pressed,
                ]}
              >
                <ArrowLeft size={17} color={colors.primary[700]} />
              </Pressable>
            </View>

            {currentPage ? (
              <PdfPagePreview
                uri={uri}
                page={page}
                pageRatio={currentPage.height / currentPage.width}
                region={region}
                onRegionSelected={handleRegionSelected}
              />
            ) : null}

            {currentPage && currentPage.items.length > 0 ? (
              <View style={styles.textSelection}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    textChoicesVisible
                      ? 'إخفاء قائمة النصوص المستخرجة'
                      : 'اختيار البيان من قائمة النصوص المستخرجة'
                  }
                  accessibilityState={{ expanded: textChoicesVisible }}
                  onPress={() => setTextChoicesVisible((visible) => !visible)}
                  style={({ pressed }) => [styles.textChoiceToggle, pressed && styles.pressed]}
                >
                  <Text style={styles.textChoiceToggleText}>
                    {textChoicesVisible
                      ? 'إخفاء قائمة النصوص'
                      : 'اختيار البيان من قائمة النصوص'}
                  </Text>
                </Pressable>
                {textChoicesVisible ? (
                  <View style={styles.textChoicePanel}>
                    <Text accessibilityRole="header" style={styles.textChoiceHeading}>
                      نصوص صفحة {page}
                    </Text>
                    <TextInput
                      accessibilityLabel="البحث في نصوص صفحة PDF"
                      accessibilityHint="اكتب جزءًا من النص لتصفية خيارات البيان"
                      onChangeText={setTextSearch}
                      placeholder="ابحث في نصوص الصفحة"
                      placeholderTextColor={colors.neutral[500]}
                      style={styles.textChoiceSearch}
                      textAlign="right"
                      value={textSearch}
                    />
                    {matchingTextItems.length > visibleTextItems.length ? (
                      <Text style={styles.textChoiceHint}>
                        تظهر أول ٥٠ نتيجة؛ استخدم البحث لتضييق القائمة.
                      </Text>
                    ) : null}
                    <ScrollView
                      nestedScrollEnabled
                      keyboardShouldPersistTaps="handled"
                      style={styles.textChoiceList}
                    >
                      {visibleTextItems.map((item, index) => (
                        <Pressable
                          key={`${page}-${item.left}-${item.top}-${index}`}
                          accessibilityRole="button"
                          accessibilityLabel={`اختيار النص: ${item.text}`}
                          accessibilityHint={scope === 'rows'
                            ? 'سيحدد موضع العمود فقط؛ اسحب نطاق الصفوف يدويًا قبل الاعتماد.'
                            : 'سيتم تحديد موضع النص وعرض العينة قبل اعتمادها.'}
                          onPress={() => handleTextItemSelected(item)}
                          style={({ pressed }) => [
                            styles.textChoice,
                            pressed && styles.pressed,
                          ]}
                        >
                          <Text style={styles.textChoiceValue} numberOfLines={2}>
                            {item.text}
                          </Text>
                        </Pressable>
                      ))}
                      {visibleTextItems.length === 0 ? (
                        <Text style={styles.textChoiceHint}>لا توجد نصوص مطابقة في هذه الصفحة.</Text>
                      ) : null}
                    </ScrollView>
                  </View>
                ) : null}
              </View>
            ) : null}

            {!hasText ? (
              <View style={styles.notice}>
                <Text accessibilityLiveRegion="polite" style={styles.errorText}>
                  لا يحتوي هذا الملف على نص قابل للتحديد. اختيار المناطق يتطلب مستند PDF نصيًا؛
                  لا يتوفر OCR للملفات الممسوحة ضوئيًا حاليًا.
                </Text>
              </View>
            ) : null}

            <View style={styles.selectionResult}>
              <Text accessibilityLiveRegion="polite" style={styles.resultLabel}>
                {region
                  ? scope === 'rows'
                    ? `قيم الصفوف المحددة في الصفحة ${page}`
                    : `القيمة المحددة في الصفحة ${page}`
                  : 'القيمة المستخرجة'}
              </Text>
              <Text accessibilityLiveRegion="polite" style={styles.resultValue}>
                {pageValues || 'لم يتم تحديد بيان بعد'}
              </Text>
              {region && validPageValues > 0 &&
                (scope !== 'rows' || rowRangeSelected) ? (
                <Text style={styles.resultMeta}>
                  {scope === 'rows'
                    ? `تم العثور على ${validPageValues} قيمة صفية ضمن النطاق المحدد`
                    : `تم العثور على قيمة في ${validPageValues} صفحة من ${pageSizes.length}`}
                </Text>
              ) : null}
              {region?.scope === 'rows' && !rowRangeSelected ? (
                <Text accessibilityLiveRegion="polite" style={styles.resultMeta}>
                  لا يمكن اعتماد هذا التحديد قبل سحب نطاق صفوف البيانات.
                </Text>
              ) : null}
            </View>

            {error ? (
              <Text accessibilityRole="alert" style={styles.errorText}>{error}</Text>
            ) : null}
          </ScrollView>
        ) : null}

        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="إلغاء اختيار البيان"
            onPress={onCancel}
            style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]}
          >
            <Text style={styles.cancelText}>إلغاء</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="استخدام البيان المحدد"
            accessibilityState={{ disabled: !canSelect }}
            disabled={!canSelect}
            onPress={handleSelect}
            style={({ pressed }) => [
              styles.confirmButton,
              !canSelect && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            <Check size={18} color={colors.neutral[0]} />
            <Text style={styles.confirmText}>استخدام هذا البيان</Text>
          </Pressable>
        </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.neutral[50],
  },
  header: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.neutral[0],
    borderBottomWidth: 1,
    borderBottomColor: colors.neutral[200],
  },
  headerCopy: {
    flex: 1,
    alignItems: 'flex-end',
    gap: 2,
  },
  heading: {
    fontFamily: fonts.bold,
    fontSize: 18,
    color: colors.neutral[900],
    writingDirection: 'rtl',
  },
  subheading: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.neutral[600],
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  closeButton: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.neutral[100],
  },
  content: {
    gap: spacing.sm,
    padding: spacing.md,
  },
  scopeSelector: {
    gap: spacing.xs,
    padding: spacing.sm,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.neutral[200],
    backgroundColor: colors.neutral[0],
  },
  scopeHeading: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.neutral[800],
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  scopeOptions: {
    flexDirection: 'row-reverse',
    gap: spacing.xs,
  },
  scopeOption: {
    minHeight: 40,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: colors.neutral[300],
    backgroundColor: colors.neutral[0],
  },
  scopeOptionSelected: {
    borderColor: colors.primary[600],
    backgroundColor: colors.primary[50],
  },
  scopeOptionText: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.neutral[700],
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  scopeOptionTextSelected: {
    fontFamily: fonts.semibold,
    color: colors.primary[800],
  },
  scopeHint: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 18,
    color: colors.neutral[600],
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  textSelection: {
    gap: spacing.xs,
  },
  textChoiceToggle: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.primary[200],
    backgroundColor: colors.primary[50],
    paddingHorizontal: spacing.sm,
  },
  textChoiceToggleText: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.primary[800],
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  textChoicePanel: {
    gap: spacing.xs,
    padding: spacing.xs,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.neutral[200],
    backgroundColor: colors.neutral[0],
  },
  textChoiceHeading: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.neutral[800],
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  textChoiceSearch: {
    minHeight: 44,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: colors.neutral[300],
    backgroundColor: colors.neutral[50],
    paddingHorizontal: spacing.xs,
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.neutral[900],
    writingDirection: 'rtl',
  },
  textChoiceHint: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 18,
    color: colors.neutral[600],
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  textChoiceList: {
    maxHeight: 220,
  },
  textChoice: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.neutral[100],
  },
  textChoiceValue: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.neutral[800],
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  pageToolbar: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  pageButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary[50],
    borderWidth: 1,
    borderColor: colors.primary[200],
  },
  pageCounter: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.neutral[800],
    writingDirection: 'rtl',
  },
  selectionResult: {
    gap: 5,
    padding: spacing.sm,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.primary[200],
    backgroundColor: colors.primary[50],
  },
  resultLabel: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.primary[800],
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  resultValue: {
    minHeight: 24,
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.neutral[900],
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  resultMeta: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.neutral[600],
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  notice: {
    padding: spacing.sm,
    borderRadius: 12,
    backgroundColor: colors.error[50],
  },
  footer: {
    flexDirection: 'row-reverse',
    gap: spacing.sm,
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.neutral[200],
    backgroundColor: colors.neutral[0],
  },
  cancelButton: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.neutral[300],
  },
  cancelText: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.neutral[700],
    writingDirection: 'rtl',
  },
  confirmButton: {
    flex: 1.5,
    minHeight: 48,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 12,
    backgroundColor: colors.primary[700],
  },
  confirmText: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.neutral[0],
    writingDirection: 'rtl',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.md,
  },
  statusText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.neutral[600],
    writingDirection: 'rtl',
  },
  errorText: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.error[700],
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  disabled: {
    opacity: 0.45,
  },
  pressed: {
    opacity: 0.78,
  },
});

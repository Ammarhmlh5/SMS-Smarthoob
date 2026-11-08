/**
 * TemplatePreviewModal
 * نافذة معاينة القالب بقيم تجريبية للمتغيرات
 */
import { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Eye, MessageSquare, X } from 'lucide-react-native';
import { extractPlaceholders, renderMessage } from '@/lib/templates';
import type { MessageTemplate } from '@/lib/templates';
import { colors, fonts, spacing } from '@/constants/theme';

/** قيم تجريبية افتراضية لكل متغير */
const SAMPLE_DEFAULTS: Record<string, string> = {
  الاسم: 'أحمد محمد',
  الاسم_الكامل: 'أحمد محمد العمري',
  اسم_العميل: 'أحمد محمد',
  العميل: 'أحمد محمد',
  المبلغ: '١٥٠.٠٠',
  المبلغ_الإجمالي: '١٨٠.٠٠',
  الرقم: '١٠٠١',
  رقم_الفاتورة: 'INV-١٠٠١',
  رقم_الطلب: 'ORD-٥٥٢',
  التاريخ: new Date().toLocaleDateString('ar-SA'),
  تاريخ_الاستحقاق: new Date().toLocaleDateString('ar-SA'),
  الشركة: 'شركة هدهد',
  المنشأة: 'مؤسسة النور',
  الخدمة: 'الاشتراك الشهري',
  العملة: 'ريال',
  name: 'Ahmed Mohammed',
  amount: '150.00',
  date: new Date().toLocaleDateString('en'),
  invoice: 'INV-1001',
  company: 'Hodhod Co.',
};

type Props = {
  template: MessageTemplate;
  visible: boolean;
  onClose: () => void;
};

export function TemplatePreviewModal({ template, visible, onClose }: Props) {
  const placeholders = extractPlaceholders(template.body);

  // بناء الحالة الأولية بالقيم التجريبية
  const buildInitial = () => {
    const init: Record<string, string> = {};
    for (const ph of placeholders) {
      init[ph] = SAMPLE_DEFAULTS[ph] ?? `[${ph}]`;
    }
    return init;
  };

  const [values, setValues] = useState<Record<string, string>>(buildInitial);
  const preview = renderMessage(template.body, values);
  const charCount = preview.length;

  const setValue = (key: string, val: string) =>
    setValues((prev) => ({ ...prev, [key]: val }));

  const reset = () => setValues(buildInitial());

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          {/* رأس النافذة */}
          <View style={styles.header}>
            <Text style={styles.heading}>معاينة القالب</Text>
            <Pressable
              onPress={onClose}
              style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="إغلاق المعاينة"
            >
              <X size={20} color={colors.neutral[500]} strokeWidth={2} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* اسم القالب */}
            <Text style={styles.templateName}>{template.title}</Text>

            {/* نص الرسالة المعاينة */}
            <View style={styles.previewBox}>
              <View style={styles.previewHeader}>
                <MessageSquare size={15} color={colors.primary[700]} strokeWidth={2} />
                <Text style={styles.previewLabel}>نص الرسالة المولّدة</Text>
                <Text style={styles.charCount}>{charCount} حرف</Text>
              </View>
              <Text style={styles.previewText}>{preview}</Text>
            </View>

            {/* حقول المتغيرات التجريبية */}
            {placeholders.length > 0 ? (
              <View style={styles.varsSection}>
                <View style={styles.varsSectionHeader}>
                  <Text style={styles.varsSectionTitle}>قيم تجريبية للمتغيرات</Text>
                  <Pressable
                    onPress={reset}
                    style={({ pressed }) => [styles.resetBtn, pressed && styles.pressed]}
                  >
                    <Text style={styles.resetText}>إعادة تعيين</Text>
                  </Pressable>
                </View>
                {placeholders.map((ph) => (
                  <View key={ph} style={styles.varRow}>
                    <Text style={styles.varLabel}>{`{{${ph}}}`}</Text>
                    <TextInput
                      value={values[ph] ?? ''}
                      onChangeText={(v) => setValue(ph, v)}
                      style={styles.varInput}
                      placeholder={`قيمة ${ph}`}
                      placeholderTextColor={colors.neutral[400]}
                    />
                  </View>
                ))}
              </View>
            ) : (
              <View style={styles.noVarsBox}>
                <Eye size={18} color={colors.neutral[400]} strokeWidth={1.5} />
                <Text style={styles.noVarsText}>لا توجد متغيرات في هذا القالب</Text>
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.neutral[0],
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
    paddingBottom: 24,
  },
  header: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.neutral[100],
  },
  heading: {
    fontFamily: fonts.bold,
    fontSize: 18,
    color: colors.neutral[900],
    writingDirection: 'rtl',
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.neutral[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.75 },
  scroll: { flex: 1 },
  scrollContent: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  templateName: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.neutral[700],
    textAlign: 'right',
    writingDirection: 'rtl',
    marginBottom: 4,
  },
  previewBox: {
    backgroundColor: colors.primary[50],
    borderWidth: 1,
    borderColor: colors.primary[200],
    borderRadius: 16,
    padding: spacing.sm,
    gap: spacing.xs / 2,
  },
  previewHeader: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 5,
  },
  previewLabel: {
    flex: 1,
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.primary[700],
    writingDirection: 'rtl',
  },
  charCount: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.neutral[400],
  },
  previewText: {
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 26,
    color: colors.neutral[800],
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  varsSection: {
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  varsSectionHeader: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  varsSectionTitle: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.neutral[600],
    writingDirection: 'rtl',
  },
  resetBtn: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: colors.neutral[100],
  },
  resetText: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.neutral[500],
    writingDirection: 'rtl',
  },
  varRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.xs,
  },
  varLabel: {
    width: 110,
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.primary[700],
    writingDirection: 'ltr',
    textAlign: 'right',
  },
  varInput: {
    flex: 1,
    height: 40,
    borderWidth: 1,
    borderColor: colors.neutral[200],
    borderRadius: 10,
    paddingHorizontal: spacing.sm,
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.neutral[800],
    backgroundColor: colors.neutral[50],
    textAlign: 'right',
  },
  noVarsBox: {
    alignItems: 'center',
    gap: 6,
    paddingVertical: spacing.sm,
  },
  noVarsText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.neutral[400],
    writingDirection: 'rtl',
  },
});

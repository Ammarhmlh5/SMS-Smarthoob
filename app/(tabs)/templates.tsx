import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FileText, Plus, RotateCw } from 'lucide-react-native';
import { EmptyState } from '@/components/EmptyState';
import { TemplateCard } from '@/components/TemplateCard';
import { TemplateForm } from '@/components/TemplateForm';
import { TemplatePreviewModal } from '@/components/TemplatePreviewModal';
import { fetchTemplates } from '@/lib/templates';
import type { MessageTemplate } from '@/lib/templates';
import { colors, fonts, spacing } from '@/constants/theme';

/** فئات التصفية */
type FilterTab = 'all' | 'default' | 'custom';

type FormState =
  | { mode: 'closed' }
  | { mode: 'create'; initialValues?: { title: string; body: string } }
  | { mode: 'edit'; template: MessageTemplate };

export default function TemplatesScreen() {
  const insets = useSafeAreaInsets();
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({ mode: 'closed' });
  const [filterTab, setFilterTab] = useState<FilterTab>('all');
  const [previewTemplate, setPreviewTemplate] = useState<MessageTemplate | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setTemplates(await fetchTemplates());
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'تعذر تحميل القوالب.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /** القوالب المصفّاة حسب التبويب المختار */
  const filtered = useMemo(() => {
    if (filterTab === 'default') return templates.filter((t) => t.is_default);
    if (filterTab === 'custom') return templates.filter((t) => !t.is_default);
    return templates;
  }, [templates, filterTab]);

  /** إحصاءات التبويبات */
  const counts = useMemo(() => ({
    all: templates.length,
    default: templates.filter((t) => t.is_default).length,
    custom: templates.filter((t) => !t.is_default).length,
  }), [templates]);

  const handleSaved = (saved: MessageTemplate) => {
    setTemplates((current) => {
      const exists = current.some((t) => t.id === saved.id);
      return exists
        ? [saved, ...current.filter((t) => t.id !== saved.id)]
        : [saved, ...current];
    });
    setForm({ mode: 'closed' });
  };

  const handleCopy = (tmpl: MessageTemplate) => {
    setForm({
      mode: 'create',
      initialValues: {
        title: `نسخة من ${tmpl.title}`,
        body: tmpl.body,
      },
    });
  };

  const handleDeleted = (id: string) => {
    setTemplates((current) => current.filter((t) => t.id !== id));
    setForm((current) =>
      current.mode === 'edit' && current.template.id === id ? { mode: 'closed' } : current,
    );
  };

  const showEmpty = !loading && !loadError && filtered.length === 0;
  const isFormOpen = form.mode !== 'closed';

  return (
    <View style={styles.screen}>
      {/* رأس الشاشة */}
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.headerText}>
          <Text style={styles.heading}>القوالب</Text>
          <Text style={styles.subheading}>أنشئ رسائل جاهزة تستخدمها في حملاتك</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="إنشاء قالب جديد"
          onPress={() => setForm({ mode: 'create' })}
          style={({ pressed }) => [styles.addBtn, pressed && styles.pressed]}
        >
          <Plus size={20} color={colors.neutral[0]} strokeWidth={2.5} />
          <Text style={styles.addBtnText}>قالب جديد</Text>
        </Pressable>
      </View>

      {/* تبويبات التصفية */}
      <View style={styles.tabsRow}>
        {([
          ['all', 'الكل'],
          ['default', 'افتراضية'],
          ['custom', 'مخصصة'],
        ] as [FilterTab, string][]).map(([key, label]) => (
          <Pressable
            key={key}
            onPress={() => setFilterTab(key)}
            style={({ pressed }) => [
              styles.tab,
              filterTab === key && styles.tabActive,
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.tabText, filterTab === key && styles.tabTextActive]}>
              {label}
            </Text>
            <View style={[styles.tabBadge, filterTab === key && styles.tabBadgeActive]}>
              <Text style={[styles.tabBadgeText, filterTab === key && styles.tabBadgeTextActive]}>
                {counts[key]}
              </Text>
            </View>
          </Pressable>
        ))}
      </View>

      {/* محتوى الشاشة */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary[700]} />
          <Text style={styles.loadingText}>جاري التحميل…</Text>
        </View>
      ) : loadError ? (
        <View style={styles.centered}>
          <Text style={styles.errorText}>{loadError}</Text>
          <Pressable
            onPress={load}
            style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
          >
            <RotateCw size={16} color={colors.primary[700]} strokeWidth={2} />
            <Text style={styles.retryText}>إعادة المحاولة</Text>
          </Pressable>
        </View>
      ) : showEmpty ? (
        <View style={styles.emptyWrap}>
          <EmptyState
            Icon={FileText}
            title={filterTab === 'custom' ? 'لا توجد قوالب مخصصة' : 'لا توجد قوالب بعد'}
            description={
              filterTab === 'custom'
                ? 'أنشئ قالبك الأول بالضغط على "قالب جديد"'
                : 'أنشئ قالبك الأول لاستخدامه في إرسال الفواتير'
            }
          />
          {filterTab !== 'default' && (
            <Pressable
              accessibilityRole="button"
              onPress={() => setForm({ mode: 'create' })}
              style={({ pressed }) => [styles.createButton, pressed && styles.pressed]}
            >
              <Plus size={18} color={colors.neutral[0]} strokeWidth={2} />
              <Text style={styles.createText}>إنشاء قالب جديد</Text>
            </Pressable>
          )}
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {filtered.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              disabled={isFormOpen}
              onEdit={() => setForm({ mode: 'edit', template })}
              onCopy={() => handleCopy(template)}
              onPreview={() => setPreviewTemplate(template)}
              onDeleted={handleDeleted}
            />
          ))}
          {/* مساحة سفلية */}
          <View style={{ height: insets.bottom + spacing.md }} />
        </ScrollView>
      )}

      {/* Modal نموذج الإنشاء/التعديل */}
      <Modal
        visible={isFormOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setForm({ mode: 'closed' })}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.modalContent}
              showsVerticalScrollIndicator={false}
            >
              <TemplateForm
                key={form.mode === 'edit' ? form.template.id : 'create'}
                template={form.mode === 'edit' ? form.template : null}
                initialValues={form.mode === 'create' ? form.initialValues : undefined}
                onSaved={handleSaved}
                onCancel={() => setForm({ mode: 'closed' })}
              />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Modal المعاينة */}
      {previewTemplate && (
        <TemplatePreviewModal
          template={previewTemplate}
          visible={previewTemplate !== null}
          onClose={() => setPreviewTemplate(null)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.neutral[50],
  },
  topBar: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: colors.neutral[0],
    borderBottomWidth: 1,
    borderBottomColor: colors.neutral[100],
    gap: spacing.sm,
  },
  headerText: {
    flex: 1,
    alignItems: 'flex-end',
    gap: 2,
  },
  heading: {
    fontFamily: fonts.bold,
    fontSize: 26,
    lineHeight: 34,
    color: colors.neutral[900],
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  subheading: {
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 20,
    color: colors.neutral[500],
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  addBtn: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.primary[700],
    borderRadius: 12,
    paddingHorizontal: spacing.sm,
    height: 42,
  },
  addBtnText: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.neutral[0],
    writingDirection: 'rtl',
  },
  tabsRow: {
    flexDirection: 'row-reverse',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
    backgroundColor: colors.neutral[0],
  },
  tab: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.sm,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.neutral[200],
    backgroundColor: colors.neutral[0],
  },
  tabActive: {
    borderColor: colors.primary[300],
    backgroundColor: colors.primary[50],
  },
  tabText: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.neutral[500],
    writingDirection: 'rtl',
  },
  tabTextActive: {
    color: colors.primary[700],
  },
  tabBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.neutral[100],
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  tabBadgeActive: {
    backgroundColor: colors.primary[200],
  },
  tabBadgeText: {
    fontFamily: fonts.bold,
    fontSize: 11,
    color: colors.neutral[500],
  },
  tabBadgeTextActive: {
    color: colors.primary[800],
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.md,
  },
  loadingText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.neutral[500],
    writingDirection: 'rtl',
  },
  errorText: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.error[600],
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  retryButton: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.xs / 2,
    paddingHorizontal: spacing.sm,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.primary[200],
    backgroundColor: colors.primary[50],
  },
  retryText: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.primary[700],
    writingDirection: 'rtl',
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.md,
  },
  createButton: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.primary[700],
    borderRadius: 14,
    paddingHorizontal: spacing.md,
    height: 50,
  },
  createText: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.neutral[0],
    writingDirection: 'rtl',
  },
  list: {
    padding: spacing.sm,
    gap: spacing.sm,
  },
  pressed: { opacity: 0.8 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.neutral[0],
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
    paddingBottom: 24,
  },
  modalContent: {
    padding: spacing.md,
  },
});

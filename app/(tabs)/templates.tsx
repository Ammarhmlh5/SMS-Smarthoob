import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FileText, Plus, RotateCw } from 'lucide-react-native';
import { EmptyState } from '@/components/EmptyState';
import { TemplateCard } from '@/components/TemplateCard';
import { TemplateForm } from '@/components/TemplateForm';
import { fetchTemplates } from '@/lib/templates';
import type { MessageTemplate } from '@/lib/templates';
import { colors, fonts, spacing } from '@/constants/theme';

type FormState = { mode: 'closed' } | { mode: 'create' } | { mode: 'edit'; template: MessageTemplate };

export default function TemplatesScreen() {
  const insets = useSafeAreaInsets();
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({ mode: 'closed' });

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

  useEffect(() => {
    load();
  }, [load]);

  const handleSaved = (saved: MessageTemplate) => {
    setTemplates((current) => {
      const exists = current.some((t) => t.id === saved.id);
      return exists
        ? [saved, ...current.filter((t) => t.id !== saved.id)]
        : [saved, ...current];
    });
    setForm({ mode: 'closed' });
  };

  const handleDeleted = (id: string) => {
    setTemplates((current) => current.filter((t) => t.id !== id));
    setForm((current) =>
      current.mode === 'edit' && current.template.id === id ? { mode: 'closed' } : current,
    );
  };

  const showEmpty = !loading && !loadError && templates.length === 0 && form.mode === 'closed';

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md, paddingBottom: spacing.lg }]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <Text style={styles.heading}>القوالب</Text>
        <Text style={styles.subheading}>أنشئ رسائل جاهزة تستخدمها في حملاتك مع دعم المتغيرات</Text>
      </View>

      {loading ? (
        <View style={styles.card}>
          <View style={styles.centered}>
            <ActivityIndicator color={colors.primary[700]} />
          </View>
        </View>
      ) : loadError ? (
        <View style={styles.card}>
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{loadError}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="إعادة المحاولة"
              onPress={load}
              style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
            >
              <RotateCw size={16} color={colors.primary[700]} strokeWidth={2} />
              <Text style={styles.retryText}>إعادة المحاولة</Text>
            </Pressable>
          </View>
        </View>
      ) : showEmpty ? (
        <View style={styles.emptyWrap}>
          <EmptyState
            Icon={FileText}
            title="لا توجد قوالب بعد"
            description="أنشئ قالبك الأول لاستخدامه في إرسال الفواتير"
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="إنشاء قالب جديد"
            onPress={() => setForm({ mode: 'create' })}
            style={({ pressed }) => [styles.createButton, pressed && styles.pressed]}
          >
            <Plus size={18} color={colors.neutral[0]} strokeWidth={2} />
            <Text style={styles.createText}>إنشاء قالب جديد</Text>
          </Pressable>
        </View>
      ) : (
        <>
          {templates.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              disabled={form.mode !== 'closed'}
              onEdit={() => setForm({ mode: 'edit', template })}
              onDeleted={handleDeleted}
            />
          ))}

          {form.mode === 'closed' ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="إضافة قالب جديد"
              onPress={() => setForm({ mode: 'create' })}
              style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
            >
              <Plus size={18} color={colors.primary[700]} strokeWidth={2} />
              <Text style={styles.addText}>إضافة قالب جديد</Text>
            </Pressable>
          ) : (
            <View style={styles.card}>
              <TemplateForm
                key={form.mode === 'edit' ? form.template.id : 'create'}
                template={form.mode === 'edit' ? form.template : null}
                onSaved={handleSaved}
                onCancel={() => setForm({ mode: 'closed' })}
              />
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.neutral[50],
  },
  content: {
    paddingHorizontal: spacing.sm,
    gap: spacing.sm,
  },
  header: {
    gap: spacing.xs / 2,
    paddingHorizontal: spacing.xs / 2,
    marginBottom: spacing.xs / 2,
  },
  heading: {
    fontFamily: fonts.bold,
    fontSize: 28,
    lineHeight: 34,
    color: colors.neutral[900],
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  subheading: {
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 24,
    color: colors.neutral[500],
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  card: {
    backgroundColor: colors.neutral[0],
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.neutral[200],
    padding: spacing.sm,
    gap: spacing.sm,
  },
  centered: {
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  errorBox: {
    gap: spacing.sm,
    alignItems: 'flex-end',
  },
  errorText: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    lineHeight: 21,
    color: colors.error[600],
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  retryButton: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.xs / 2,
    paddingHorizontal: spacing.sm,
    height: 40,
    borderRadius: 12,
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
    gap: spacing.lg,
  },
  createButton: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs / 2,
    height: 52,
    borderRadius: 14,
    backgroundColor: colors.primary[700],
  },
  createText: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.neutral[0],
    writingDirection: 'rtl',
  },
  addButton: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs / 2,
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.primary[200],
    backgroundColor: colors.primary[50],
  },
  addText: {
    fontFamily: fonts.semibold,
    fontSize: 15,
    color: colors.primary[700],
    writingDirection: 'rtl',
  },
  pressed: {
    opacity: 0.8,
  },
});

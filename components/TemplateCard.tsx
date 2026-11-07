import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Pencil, Trash2 } from 'lucide-react-native';
import { formStyles } from '@/components/FormField';
import { deleteTemplate, extractPlaceholders } from '@/lib/templates';
import type { MessageTemplate } from '@/lib/templates';
import { colors, fonts, spacing } from '@/constants/theme';

type TemplateCardProps = {
  template: MessageTemplate;
  disabled: boolean;
  onEdit: () => void;
  onDeleted: (id: string) => void;
};

export function TemplateCard({ template, disabled, onEdit, onDeleted }: TemplateCardProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const placeholders = extractPlaceholders(template.body);
  const isLong = template.body.length > 120;
  const displayBody = expanded || !isLong ? template.body : template.body.slice(0, 120) + '…';

  const confirmDelete = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteTemplate(template.id);
      onDeleted(template.id);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'تعذر حذف القالب. حاول مرة أخرى.');
      setDeleting(false);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.titleBlock}>
          <Text style={styles.title} numberOfLines={1}>{template.title}</Text>
          <Text style={styles.date}>
            {new Date(template.updated_at).toLocaleDateString('ar', {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
            })}
          </Text>
        </View>
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="تعديل القالب"
            onPress={onEdit}
            disabled={disabled}
            style={({ pressed }) => [styles.iconButton, pressed && formStyles.pressed, disabled && formStyles.disabled]}
          >
            <Pencil size={18} color={colors.primary[700]} strokeWidth={2} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="حذف القالب"
            onPress={() => setConfirmingDelete(true)}
            disabled={disabled}
            style={({ pressed }) => [styles.iconButton, styles.deleteButton, pressed && formStyles.pressed, disabled && formStyles.disabled]}
          >
            <Trash2 size={18} color={colors.error[600]} strokeWidth={2} />
          </Pressable>
        </View>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={expanded ? 'طي النص' : 'عرض النص كاملاً'}
        onPress={() => setExpanded((v) => !v)}
        disabled={!isLong}
      >
        <Text style={styles.body}>{displayBody}</Text>
      </Pressable>

      {placeholders.length > 0 ? (
        <View style={styles.placeholdersList}>
          {placeholders.map((ph) => (
            <View key={ph} style={styles.placeholderChip}>
              <Text style={styles.placeholderText}>{`{{${ph}}}`}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {confirmingDelete ? (
        <View style={styles.confirmBox}>
          <Text style={styles.confirmText}>هل تريد حذف هذا القالب نهائياً؟</Text>
          <View style={styles.confirmActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="إلغاء الحذف"
              onPress={() => setConfirmingDelete(false)}
              disabled={deleting}
              style={({ pressed }) => [styles.confirmCancel, pressed && formStyles.pressed]}
            >
              <Text style={styles.confirmCancelText}>إلغاء</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="تأكيد الحذف"
              onPress={confirmDelete}
              disabled={deleting}
              style={({ pressed }) => [styles.confirmDelete, pressed && formStyles.pressed, deleting && formStyles.disabled]}
            >
              {deleting ? (
                <ActivityIndicator size="small" color={colors.neutral[0]} />
              ) : (
                <Text style={styles.confirmDeleteText}>حذف</Text>
              )}
            </Pressable>
          </View>
          {deleteError ? <Text style={formStyles.errorText}>{deleteError}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.neutral[200],
    backgroundColor: colors.neutral[50],
    padding: spacing.sm,
    gap: spacing.xs,
  },
  header: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  titleBlock: {
    flex: 1,
    gap: 2,
    alignItems: 'flex-end',
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: 16,
    lineHeight: 24,
    color: colors.neutral[900],
    writingDirection: 'rtl',
  },
  date: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 18,
    color: colors.neutral[400],
    writingDirection: 'rtl',
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.xs / 2,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.primary[200],
    backgroundColor: colors.neutral[0],
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteButton: {
    borderColor: colors.error[500],
  },
  body: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 22,
    color: colors.neutral[700],
    textAlign: 'right',
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
    paddingVertical: 3,
  },
  placeholderText: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.primary[700],
    writingDirection: 'ltr',
  },
  confirmBox: {
    gap: spacing.xs,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.neutral[200],
  },
  confirmText: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    lineHeight: 21,
    color: colors.neutral[700],
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  confirmActions: {
    flexDirection: 'row-reverse',
    gap: spacing.xs,
  },
  confirmCancel: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.neutral[200],
    backgroundColor: colors.neutral[0],
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmCancelText: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.neutral[700],
    writingDirection: 'rtl',
  },
  confirmDelete: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.error[600],
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmDeleteText: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.neutral[0],
    writingDirection: 'rtl',
  },
});

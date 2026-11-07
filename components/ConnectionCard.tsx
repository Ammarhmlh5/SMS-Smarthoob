import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Pencil, Trash2, Wifi, WifiOff } from 'lucide-react-native';
import { formStyles } from '@/components/FormField';
import { deleteGatewayConnection, testGatewayConnection } from '@/lib/gatewaySettings';
import type { ConnectionTestResult, GatewayConnection } from '@/lib/gatewaySettings';
import { colors, fonts, spacing } from '@/constants/theme';

type ConnectionCardProps = {
  connection: GatewayConnection;
  disabled: boolean;
  onEdit: () => void;
  onDeleted: (id: string) => void;
};

type TestState =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'done'; result: ConnectionTestResult }
  | { status: 'error'; message: string };

function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint;
  }
}

export function ConnectionCard({ connection, disabled, onEdit, onDeleted }: ConnectionCardProps) {
  const [test, setTest] = useState<TestState>({ status: 'idle' });
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const runTest = async () => {
    setTest({ status: 'testing' });
    try {
      setTest({ status: 'done', result: await testGatewayConnection(connection.id) });
    } catch (err) {
      setTest({ status: 'error', message: err instanceof Error ? err.message : 'تعذر إجراء الاختبار.' });
    }
  };

  const confirmDelete = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteGatewayConnection(connection.id);
      onDeleted(connection.id);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'تعذر حذف الخدمة. حاول مرة أخرى.');
      setDeleting(false);
    }
  };

  const testing = test.status === 'testing';
  const actionsDisabled = disabled || testing || deleting;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.titleBlock}>
          <Text style={styles.sender}>{connection.sender_name}</Text>
          <Text style={styles.host}>{hostOf(connection.endpoint_url)}</Text>
        </View>
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="اختبار الاتصال بالخدمة"
            onPress={runTest}
            disabled={actionsDisabled}
            style={({ pressed }) => [styles.iconButton, pressed && formStyles.pressed, actionsDisabled && formStyles.disabled]}
          >
            {testing ? (
              <ActivityIndicator size="small" color={colors.primary[700]} />
            ) : (
              <Wifi size={18} color={colors.primary[700]} strokeWidth={2} />
            )}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="تعديل الخدمة"
            onPress={onEdit}
            disabled={actionsDisabled}
            style={({ pressed }) => [styles.iconButton, pressed && formStyles.pressed, actionsDisabled && formStyles.disabled]}
          >
            <Pencil size={18} color={colors.primary[700]} strokeWidth={2} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="حذف الخدمة"
            onPress={() => setConfirmingDelete(true)}
            disabled={actionsDisabled}
            style={({ pressed }) => [styles.iconButton, styles.deleteButton, pressed && formStyles.pressed, actionsDisabled && formStyles.disabled]}
          >
            <Trash2 size={18} color={colors.error[600]} strokeWidth={2} />
          </Pressable>
        </View>
      </View>

      {test.status === 'done' && test.result.reachable ? (
        <View style={formStyles.successRow}>
          <Wifi size={16} color={colors.success[600]} strokeWidth={2} />
          <Text style={formStyles.successText}>
            العنوان يستجيب بشكل صحيح{test.result.status ? ` (رمز ${test.result.status})` : ''}
          </Text>
        </View>
      ) : null}

      {test.status === 'done' && !test.result.reachable ? (
        <View style={formStyles.successRow}>
          <WifiOff size={16} color={colors.error[600]} strokeWidth={2} />
          <Text style={formStyles.errorText}>تعذر الوصول إلى العنوان. تأكد من صحته ومن عمل الخدمة.</Text>
        </View>
      ) : null}

      {test.status === 'error' ? <Text style={formStyles.errorText}>{test.message}</Text> : null}

      {confirmingDelete ? (
        <View style={styles.confirmBox}>
          <Text style={styles.confirmText}>هل تريد حذف هذه الخدمة نهائياً؟</Text>
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
    gap: spacing.xs / 2,
    alignItems: 'flex-end',
  },
  sender: {
    fontFamily: fonts.bold,
    fontSize: 16,
    lineHeight: 24,
    color: colors.neutral[900],
    writingDirection: 'rtl',
  },
  host: {
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 20,
    color: colors.neutral[500],
    writingDirection: 'ltr',
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

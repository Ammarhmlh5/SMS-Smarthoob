import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CircleCheck, CircleDashed, LogOut, Plus, RotateCw } from 'lucide-react-native';
import { ConnectionCard } from '@/components/ConnectionCard';
import { ConnectionForm } from '@/components/ConnectionForm';
import { SendingPreferencesForm } from '@/components/SendingPreferencesForm';
import { fetchGatewaySettings } from '@/lib/gatewaySettings';
import type { GatewayConnection, GatewaySettings } from '@/lib/gatewaySettings';
import { supabase } from '@/lib/supabase';
import { colors, fonts, spacing } from '@/constants/theme';

type FormState = { mode: 'closed' } | { mode: 'create' } | { mode: 'edit'; connection: GatewayConnection };

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const [signingOut, setSigningOut] = useState(false);
  const [settings, setSettings] = useState<GatewaySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({ mode: 'closed' });

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setSettings(await fetchGatewaySettings());
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'تعذر تحميل الإعدادات.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const hasConnections = settings !== null && settings.connections.length > 0;

  const handleConnectionSaved = (saved: GatewayConnection) => {
    setSettings((current) => {
      if (!current) return current;
      const exists = current.connections.some((c) => c.id === saved.id);
      const connections = exists
        ? current.connections.map((c) => (c.id === saved.id ? saved : c))
        : [...current.connections, saved];
      return { ...current, connections };
    });
    setForm({ mode: 'closed' });
  };

  const handleConnectionDeleted = (id: string) => {
    setSettings((current) =>
      current ? { ...current, connections: current.connections.filter((c) => c.id !== id) } : current,
    );
    setForm((current) => (current.mode === 'edit' && current.connection.id === id ? { mode: 'closed' } : current));
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md }]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <Text style={styles.heading}>الإعدادات</Text>
        <Text style={styles.subheading}>اربط التطبيق بخدمة إرسال الرسائل وحدد طريقة الإرسال</Text>
      </View>

      {loading ? (
        <View style={styles.card}>
          <View style={styles.centered}>
            <ActivityIndicator color={colors.primary[700]} />
          </View>
        </View>
      ) : loadError || !settings ? (
        <View style={styles.card}>
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{loadError ?? 'تعذر تحميل الإعدادات.'}</Text>
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
      ) : (
        <>
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>الخدمات المرتبطة</Text>
            <View style={[styles.statusRow, hasConnections ? styles.statusOk : styles.statusPending]}>
              {hasConnections ? (
                <CircleCheck size={18} color={colors.success[600]} strokeWidth={2} />
              ) : (
                <CircleDashed size={18} color={colors.warning[600]} strokeWidth={2} />
              )}
              <Text style={styles.statusText}>
                {hasConnections
                  ? `${settings.connections.length} ${settings.connections.length === 1 ? 'خدمة مرتبطة' : 'خدمات مرتبطة'}`
                  : 'لا توجد خدمات مرتبطة بعد'}
              </Text>
            </View>

            {settings.connections.map((connection) => (
              <ConnectionCard
                key={connection.id}
                connection={connection}
                disabled={form.mode !== 'closed'}
                onEdit={() => setForm({ mode: 'edit', connection })}
                onDeleted={handleConnectionDeleted}
              />
            ))}

            {form.mode === 'closed' ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="إضافة خدمة جديدة"
                onPress={() => setForm({ mode: 'create' })}
                style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
              >
                <Plus size={18} color={colors.primary[700]} strokeWidth={2} />
                <Text style={styles.addText}>إضافة خدمة جديدة</Text>
              </Pressable>
            ) : (
              <ConnectionForm
                key={form.mode === 'edit' ? form.connection.id : 'create'}
                connection={form.mode === 'edit' ? form.connection : null}
                onSaved={handleConnectionSaved}
                onCancel={() => setForm({ mode: 'closed' })}
              />
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>إعدادات الإرسال</Text>
            <SendingPreferencesForm initial={settings} onSaved={setSettings} />
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="تسجيل الخروج"
            onPress={async () => {
              setSigningOut(true);
              await supabase.auth.signOut();
              setSigningOut(false);
            }}
            disabled={signingOut}
            style={({ pressed }) => [styles.logoutButton, pressed && styles.pressed, signingOut && styles.disabled]}
          >
            {signingOut ? (
              <ActivityIndicator color={colors.error[600]} />
            ) : (
              <>
                <LogOut size={18} color={colors.error[600]} strokeWidth={2} />
                <Text style={styles.logoutText}>تسجيل الخروج</Text>
              </>
            )}
          </Pressable>
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
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  header: {
    gap: spacing.xs / 2,
    paddingHorizontal: spacing.xs / 2,
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
  sectionTitle: {
    fontFamily: fonts.bold,
    fontSize: 18,
    lineHeight: 26,
    color: colors.neutral[900],
    textAlign: 'right',
    writingDirection: 'rtl',
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
  statusRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.xs / 2,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 12,
  },
  statusOk: {
    backgroundColor: colors.success[500] + '1A',
  },
  statusPending: {
    backgroundColor: colors.warning[500] + '1A',
  },
  statusText: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    lineHeight: 21,
    color: colors.neutral[900],
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
  logoutButton: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs / 2,
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.error[500],
    backgroundColor: colors.neutral[0],
  },
  logoutText: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.error[600],
    writingDirection: 'rtl',
  },
  disabled: {
    opacity: 0.6,
  },
  pressed: {
    opacity: 0.8,
  },
});

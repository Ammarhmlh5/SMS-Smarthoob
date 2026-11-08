import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Bot,
  CircleCheck,
  CircleDashed,
  Database,
  Globe,
  LogOut,
  Plus,
  RefreshCw,
  RotateCw,
  Server,
  Trash2,
  User,
} from 'lucide-react-native';
import { ConnectionCard } from '@/components/ConnectionCard';
import { ConnectionForm } from '@/components/ConnectionForm';
import { SendingPreferencesForm } from '@/components/SendingPreferencesForm';
import { fetchGatewaySettings } from '@/lib/gatewaySettings';
import type { GatewayConnection, GatewaySettings } from '@/lib/gatewaySettings';
import { database } from '@/lib/database';
import { checkHealth, setApiBaseUrl } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { loadSettings, saveApiBaseUrl, DEFAULT_SETTINGS } from '@/lib/settingsStore';
import type { AppSettings } from '@/lib/settingsStore';
import { colors, fonts, spacing } from '@/constants/theme';

type FormState = { mode: 'closed' } | { mode: 'create' } | { mode: 'edit'; connection: GatewayConnection };

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();

  // ─── حالة المستخدم ──────────────────────────────────────────────────────────
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  // ─── إعدادات البوابات ────────────────────────────────────────────────────────
  const [settings, setSettings] = useState<GatewaySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({ mode: 'closed' });

  // ─── إعدادات التطبيق المحلية ─────────────────────────────────────────────────
  const [appSettings, setAppSettings] = useState<AppSettings>(DEFAULT_SETTINGS);

  // ─── المزامنة ────────────────────────────────────────────────────────────────
  const [pendingSyncCount, setPendingSyncCount] = useState<number>(0);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);

  // ─── خادم الذكاء الاصطناعي ──────────────────────────────────────────────────
  const [apiUrl, setApiUrl] = useState<string>(DEFAULT_SETTINGS.apiBaseUrl);
  const [checkingBackend, setCheckingBackend] = useState<boolean>(false);
  const [backendStatus, setBackendStatus] = useState<'idle' | 'online' | 'offline'>('idle');

  // ─── تحميل البيانات ──────────────────────────────────────────────────────────

  const refreshSyncCount = useCallback(async () => {
    try {
      const count = await database.getPendingSyncCount();
      setPendingSyncCount(count);
    } catch {
      // تجاهل
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      // تحميل إعدادات البوابات من السحابة
      const [gatewayData, localSettings, { data: { user } }] = await Promise.all([
        fetchGatewaySettings(),
        loadSettings(),
        supabase.auth.getUser(),
      ]);

      setSettings(gatewayData);
      setAppSettings(localSettings);
      setApiUrl(localSettings.apiBaseUrl);
      setApiBaseUrl(localSettings.apiBaseUrl);
      setUserEmail(user?.email ?? null);
      await refreshSyncCount();
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'تعذر تحميل الإعدادات.');
    } finally {
      setLoading(false);
    }
  }, [refreshSyncCount]);

  useEffect(() => {
    load();
  }, [load]);

  // ─── معالجات البوابات ────────────────────────────────────────────────────────

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

  // ─── معالجات المزامنة ────────────────────────────────────────────────────────

  const handleManualSync = async () => {
    setSyncing(true);
    setSyncFeedback(null);
    try {
      const res = await database.syncWithSupabase();
      await refreshSyncCount();
      setSyncFeedback(res.message);
    } catch {
      setSyncFeedback('تعذر إتمام المزامنة مع الخادم');
    } finally {
      setSyncing(false);
    }
  };

  const handleClearLocalData = () => {
    Alert.alert(
      'مسح البيانات المحلية',
      'هل أنت متأكد من مسح البيانات المخزنة محلياً وإعادة المزامنة؟ لن يتم مسح بيانات السحابة.',
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'مسح وإعادة تحميل',
          style: 'destructive',
          onPress: async () => {
            try {
              await database.clearAllData();
              await load();
              Alert.alert('تم', 'تم مسح البيانات المحلية بنجاح');
            } catch {
              Alert.alert('خطأ', 'تعذر مسح البيانات');
            }
          },
        },
      ]
    );
  };

  // ─── معالجات خادم الذكاء الاصطناعي ──────────────────────────────────────────

  const handleTestBackend = async () => {
    setCheckingBackend(true);
    const trimmedUrl = apiUrl.trim();
    setApiBaseUrl(trimmedUrl);
    try {
      await saveApiBaseUrl(trimmedUrl);
      setAppSettings((prev) => ({ ...prev, apiBaseUrl: trimmedUrl }));
      await checkHealth();
      setBackendStatus('online');
    } catch {
      setBackendStatus('offline');
    } finally {
      setCheckingBackend(false);
    }
  };

  // ─── تسجيل الخروج ────────────────────────────────────────────────────────────

  const handleSignOut = async () => {
    Alert.alert('تسجيل الخروج', 'هل أنت متأكد من تسجيل الخروج؟', [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'تسجيل الخروج',
        style: 'destructive',
        onPress: async () => {
          setSigningOut(true);
          await supabase.auth.signOut();
          setSigningOut(false);
        },
      },
    ]);
  };

  // ─── الواجهة ──────────────────────────────────────────────────────────────────

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md }]}
      keyboardShouldPersistTaps="handled"
    >
      {/* الرأس */}
      <View style={styles.header}>
        <Text style={styles.heading}>الإعدادات</Text>
        <Text style={styles.subheading}>إدارة الاتصالات، المزامنة المحلية، وخادم الذكاء الاصطناعي</Text>
      </View>

      {loading ? (
        <View style={styles.card}>
          <View style={styles.centered}>
            <ActivityIndicator color={colors.primary[700]} />
            <Text style={styles.loadingText}>جارٍ تحميل الإعدادات…</Text>
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
          {/* ── 1. إدارة بوابات الإرسال ── */}
          <View style={styles.card}>
            <View style={styles.sectionHeaderRow}>
              <Server size={20} color={colors.primary[700]} strokeWidth={2} />
              <Text style={styles.sectionTitle}>الخدمات المرتبطة (البوابات)</Text>
            </View>

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

          {/* ── 2. إعدادات الإرسال والدفعات ── */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>إعدادات الإرسال والدفعات</Text>
            <SendingPreferencesForm
              initial={settings}
              appSettings={appSettings}
              onSaved={setSettings}
              onAppSettingsSaved={setAppSettings}
            />
          </View>

          {/* ── 3. المزامنة وقاعدة البيانات المحلية ── */}
          <View style={styles.card}>
            <View style={styles.sectionHeaderRow}>
              <Database size={20} color={colors.primary[700]} strokeWidth={2} />
              <Text style={styles.sectionTitle}>المزامنة وقاعدة البيانات المحلية</Text>
            </View>
            <Text style={styles.cardDescription}>
              يعمل التطبيق بدون اتصال بالإنترنت (Offline-First) ويخزن القوالب والحملات محلياً في SQLite.
            </Text>

            <View style={styles.syncRow}>
              <Text style={styles.syncCountLabel}>سجلات معلقة بانتظار المزامنة:</Text>
              <View style={[styles.badge, pendingSyncCount > 0 ? styles.badgePending : styles.badgeSynced]}>
                <Text
                  style={[styles.badgeText, pendingSyncCount > 0 ? styles.badgePendingText : styles.badgeSyncedText]}
                >
                  {pendingSyncCount} سجل
                </Text>
              </View>
            </View>

            {syncFeedback ? <Text style={styles.syncFeedbackText}>{syncFeedback}</Text> : null}

            <View style={styles.buttonGrid}>
              <Pressable
                onPress={handleManualSync}
                disabled={syncing}
                style={({ pressed }) => [styles.actionButton, pressed && styles.pressed, syncing && styles.disabled]}
              >
                {syncing ? (
                  <ActivityIndicator color={colors.neutral[0]} size="small" />
                ) : (
                  <>
                    <RefreshCw size={16} color={colors.neutral[0]} strokeWidth={2} />
                    <Text style={styles.actionButtonText}>مزامنة الآن مع السحابة</Text>
                  </>
                )}
              </Pressable>

              <Pressable
                onPress={handleClearLocalData}
                style={({ pressed }) => [styles.dangerButton, pressed && styles.pressed]}
              >
                <Trash2 size={16} color={colors.error[600]} strokeWidth={2} />
                <Text style={styles.dangerButtonText}>مسح المحلي</Text>
              </Pressable>
            </View>
          </View>

          {/* ── 4. خادم الذكاء الاصطناعي ── */}
          <View style={styles.card}>
            <View style={styles.sectionHeaderRow}>
              <Bot size={20} color={colors.primary[700]} strokeWidth={2} />
              <Text style={styles.sectionTitle}>خادم الذكاء الاصطناعي (FastAPI Backend)</Text>
            </View>
            <Text style={styles.cardDescription}>
              يستخدم لتحليل مستندات PDF/Excel واكتشاف الأعمدة تلقائياً واقتراح القوالب باللغة العربية.
            </Text>

            <View style={styles.inputWrap}>
              <Text style={styles.inputLabel}>عنوان الخادم (API Base URL):</Text>
              <TextInput
                value={apiUrl}
                onChangeText={(text) => {
                  setApiUrl(text);
                  setBackendStatus('idle');
                }}
                placeholder="http://10.0.2.2:8000"
                placeholderTextColor={colors.neutral[400]}
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.textInput}
              />
            </View>

            <View style={styles.backendStatusRow}>
              <Pressable
                onPress={handleTestBackend}
                disabled={checkingBackend}
                style={({ pressed }) => [
                  styles.testButton,
                  pressed && styles.pressed,
                  checkingBackend && styles.disabled,
                ]}
              >
                {checkingBackend ? (
                  <ActivityIndicator color={colors.primary[700]} size="small" />
                ) : (
                  <>
                    <Globe size={16} color={colors.primary[700]} strokeWidth={2} />
                    <Text style={styles.testButtonText}>حفظ واختبار الاتصال</Text>
                  </>
                )}
              </Pressable>

              {backendStatus === 'online' ? (
                <View style={[styles.statusBadge, styles.statusBadgeOnline]}>
                  <CircleCheck size={14} color={colors.success[600]} strokeWidth={2} />
                  <Text style={styles.statusBadgeTextOnline}>متصل وجاهز</Text>
                </View>
              ) : backendStatus === 'offline' ? (
                <View style={[styles.statusBadge, styles.statusBadgeOffline]}>
                  <CircleDashed size={14} color={colors.error[600]} strokeWidth={2} />
                  <Text style={styles.statusBadgeTextOffline}>غير متصل (المحلل المحلي نشط)</Text>
                </View>
              ) : null}
            </View>
          </View>

          {/* ── 5. الحساب وتسجيل الخروج ── */}
          <View style={styles.card}>
            <View style={styles.sectionHeaderRow}>
              <User size={20} color={colors.neutral[500]} strokeWidth={2} />
              <Text style={styles.sectionTitle}>الحساب</Text>
            </View>

            {userEmail ? (
              <View style={styles.accountRow}>
                <Text style={styles.accountEmailLabel}>البريد الإلكتروني</Text>
                <Text style={styles.accountEmail}>{userEmail}</Text>
              </View>
            ) : null}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="تسجيل الخروج"
              onPress={handleSignOut}
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
          </View>
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
  sectionHeaderRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.xs / 2,
  },
  sectionTitle: {
    fontFamily: fonts.bold,
    fontSize: 18,
    lineHeight: 26,
    color: colors.neutral[900],
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  cardDescription: {
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 20,
    color: colors.neutral[500],
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  centered: {
    paddingVertical: spacing.md,
    alignItems: 'center',
    gap: spacing.xs,
  },
  loadingText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.neutral[500],
    writingDirection: 'rtl',
  },
  errorBox: {
    gap: spacing.sm,
    alignItems: 'center',
    padding: spacing.md,
  },
  errorText: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.error[600],
    textAlign: 'center',
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
    backgroundColor: colors.success[50],
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
  syncRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  syncCountLabel: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.neutral[700],
    textAlign: 'right',
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  badgeText: {
    fontFamily: fonts.semibold,
    fontSize: 12,
  },
  badgeSynced: {
    backgroundColor: colors.success[50],
  },
  badgePending: {
    backgroundColor: colors.warning[500] + '20',
  },
  badgeSyncedText: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.success[600],
  },
  badgePendingText: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.warning[600],
  },
  syncFeedbackText: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.primary[700],
    textAlign: 'center',
  },
  buttonGrid: {
    flexDirection: 'row-reverse',
    gap: spacing.xs,
    marginTop: 4,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.primary[600],
  },
  actionButtonText: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.neutral[0],
  },
  dangerButton: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 12,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.error[500],
    backgroundColor: colors.error[50],
  },
  dangerButtonText: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.error[600],
  },
  inputWrap: {
    gap: 4,
  },
  inputLabel: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.neutral[700],
    textAlign: 'right',
  },
  textInput: {
    fontFamily: fonts.regular,
    fontSize: 14,
    paddingHorizontal: spacing.sm,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.neutral[200],
    backgroundColor: colors.neutral[50],
    color: colors.neutral[900],
    writingDirection: 'ltr',
  },
  backendStatusRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  testButton: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.sm,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.primary[200],
    backgroundColor: colors.primary[50],
  },
  testButtonText: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.primary[700],
  },
  statusBadge: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusBadgeOnline: {
    backgroundColor: colors.success[50],
  },
  statusBadgeOffline: {
    backgroundColor: colors.neutral[100],
  },
  statusBadgeTextOnline: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.success[600],
  },
  statusBadgeTextOffline: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.neutral[600],
  },
  // الحساب
  accountRow: {
    gap: 2,
    paddingVertical: 4,
  },
  accountEmailLabel: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.neutral[400],
    textAlign: 'right',
  },
  accountEmail: {
    fontFamily: fonts.semibold,
    fontSize: 15,
    color: colors.neutral[800],
    textAlign: 'right',
    writingDirection: 'ltr',
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
    backgroundColor: colors.error[50],
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

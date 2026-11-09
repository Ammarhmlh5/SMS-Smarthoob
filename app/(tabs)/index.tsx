import { useCallback, useEffect, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  FileText,
  Megaphone,
  RefreshCw,
  Send,
  Sparkles,
  TrendingUp,
  Zap,
} from 'lucide-react-native';
import { database } from '@/lib/database';
import type { Campaign } from '@/lib/campaigns';
import { supabase } from '@/lib/supabase';
import { colors, fonts, spacing } from '@/constants/theme';

interface DashboardStats {
  totalCampaigns: number;
  totalMessagesSent: number;
  totalTemplates: number;
  pendingSync: number;
  failedMessages: number;
}

export default function MainMenuScreen() {
  const insets = useSafeAreaInsets();

  const [stats, setStats] = useState<DashboardStats>({
    totalCampaigns: 0,
    totalMessagesSent: 0,
    totalTemplates: 0,
    pendingSync: 0,
    failedMessages: 0,
  });
  const [recentCampaigns, setRecentCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [syncWarning, setSyncWarning] = useState<string | null>(null);

  const loadDashboard = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    setLoadError(null);
    setSyncWarning(null);
    try {
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error) throw error;

      const uid = user?.id || 'default';
      setUserEmail(user?.email ?? null);

      if (user) {
        const syncResult = await database.syncWithSupabase();
        if (!syncResult.success) {
          setSyncWarning('تعذر تحديث البيانات من الخادم؛ قد تكون البيانات المعروضة آخر نسخة محفوظة محلياً.');
        }
      }

      const [campaigns, templates, pendingCount] = await Promise.all([
        database.getCampaigns(uid),
        database.getTemplates(uid),
        database.getPendingSyncCount(),
      ]);

      const sentSum = campaigns.reduce((acc, c) => acc + (c.sent_count || 0), 0);
      const failedSum = campaigns.reduce((acc, c) => acc + (c.failed_count || 0), 0);

      setStats({
        totalCampaigns: campaigns.length,
        totalMessagesSent: sentSum,
        totalTemplates: templates.length,
        pendingSync: pendingCount,
        failedMessages: failedSum,
      });

      // آخر 3 حملات
      setRecentCampaigns(campaigns.slice(0, 3).map((campaign) => ({
        ...campaign,
        status: campaign.status === 'preparing' ? 'sending' : campaign.status,
      })));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'تعذر تحميل بيانات لوحة التحكم.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);

  const onRefresh = () => {
    setRefreshing(true);
    loadDashboard(true);
  };

  const isFirstRun = !loading && !loadError && stats.totalCampaigns === 0 && stats.totalTemplates === 0;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.sm, paddingBottom: spacing.lg + insets.bottom },
      ]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.primary[700]}
        />
      }
    >
      {/* ───── الترويسة ───── */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View style={styles.brandRow}>
            <Sparkles size={16} color={colors.primary[600]} />
            <Text style={styles.brand}>هدهد الفواتير</Text>
          </View>
          <Pressable
            onPress={onRefresh}
            style={({ pressed }) => [styles.refreshBtn, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="تحديث البيانات"
          >
            <RefreshCw size={18} color={colors.neutral[500]} strokeWidth={2} />
          </Pressable>
        </View>
        <Text style={styles.heading}>لوحة التحكم</Text>
        {userEmail ? (
          <Text style={styles.subheading}>{userEmail}</Text>
        ) : (
          <Text style={styles.subheading}>متابعة الإرسال وإدارة القوالب واستيراد الفواتير</Text>
        )}
      </View>

      {loadError ? (
        <View style={styles.loadErrorCard}>
          <AlertTriangle size={20} color={colors.error[600]} />
          <Text style={styles.loadErrorText}>{loadError}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={onRefresh}
            style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
          >
            <RefreshCw size={16} color={colors.primary[700]} strokeWidth={2} />
            <Text style={styles.retryText}>إعادة المحاولة</Text>
          </Pressable>
        </View>
      ) : (
        <>
      {syncWarning && (
        <View style={styles.syncWarningCard}>
          <AlertTriangle size={18} color={colors.warning[600]} />
          <Text style={styles.syncWarningText}>{syncWarning}</Text>
        </View>
      )}

      {/* ───── Onboarding (أول تشغيل) ───── */}
      {isFirstRun && (
        <View style={styles.onboardingCard}>
          <View style={styles.onboardingIcon}>
            <Zap size={28} color={colors.primary[700]} strokeWidth={2} />
          </View>
          <Text style={styles.onboardingTitle}>مرحباً بك في هدهد الفواتير 👋</Text>
          <Text style={styles.onboardingDesc}>
            ابدأ بإنشاء قالب رسالة، ثم أنشئ حملتك الأولى لإرسال الفواتير لعملائك.
          </Text>
        </View>
      )}

      {/* ───── شبكة الإحصائيات ───── */}
      <View style={styles.statsGrid}>
        {/* رسائل مرسلة */}
        <View style={styles.statCard}>
          <View style={[styles.statIconWrap, { backgroundColor: colors.primary[50] }]}>
            <Send size={18} color={colors.primary[700]} />
          </View>
          <Text style={styles.statValue}>{loading ? '…' : stats.totalMessagesSent.toLocaleString('ar')}</Text>
          <Text style={styles.statLabel}>رسائل مرسلة</Text>
        </View>

        {/* حملات */}
        <View style={styles.statCard}>
          <View style={[styles.statIconWrap, { backgroundColor: colors.secondary[50] }]}>
            <Megaphone size={18} color={colors.secondary[600]} />
          </View>
          <Text style={styles.statValue}>{loading ? '…' : stats.totalCampaigns}</Text>
          <Text style={styles.statLabel}>حملات منشأة</Text>
        </View>

        {/* قوالب */}
        <View style={styles.statCard}>
          <View style={[styles.statIconWrap, { backgroundColor: colors.success[50] }]}>
            <FileText size={18} color={colors.success[600]} />
          </View>
          <Text style={styles.statValue}>{loading ? '…' : stats.totalTemplates}</Text>
          <Text style={styles.statLabel}>قوالب جاهزة</Text>
        </View>

        {/* سجل المزامنة */}
        <View style={styles.statCard}>
          <View style={[styles.statIconWrap, {
            backgroundColor: stats.pendingSync > 0 ? colors.warning[500] + '20' : colors.neutral[100],
          }]}>
            <Database size={18} color={stats.pendingSync > 0 ? colors.warning[600] : colors.neutral[500]} />
          </View>
          <Text style={[styles.statValue, stats.pendingSync > 0 && { color: colors.warning[600], fontSize: 16 }]}>
            {loading ? '…' : stats.pendingSync > 0 ? `${stats.pendingSync}` : '✓'}
          </Text>
          <Text style={styles.statLabel}>{stats.pendingSync > 0 ? 'معلق للمزامنة' : 'متطابق'}</Text>
        </View>
      </View>

      {/* ───── تنبيه الرسائل الفاشلة ───── */}
      {!loading && stats.failedMessages > 0 && (
        <View style={styles.alertCard}>
          <AlertTriangle size={18} color={colors.error[600]} strokeWidth={2} />
          <Text style={styles.alertText}>
            {`${stats.failedMessages} رسالة فاشلة`}
          </Text>
        </View>
      )}

      {/* ───── آخر الحملات ───── */}
      {recentCampaigns.length > 0 && (
        <View style={styles.recentSection}>
          <View style={styles.sectionHeaderRow}>
            <TrendingUp size={17} color={colors.primary[700]} strokeWidth={2} />
            <Text style={styles.sectionTitle}>آخر الحملات</Text>
          </View>

          {recentCampaigns.map((camp) => (
            <View key={camp.id} style={styles.recentCard}>
              <View style={styles.recentHeader}>
                <Text style={styles.recentTitle} numberOfLines={1}>{camp.name}</Text>
                <View style={[
                  styles.recentBadge,
                  camp.status === 'completed' && { backgroundColor: colors.success[50] },
                  camp.status === 'failed' && { backgroundColor: colors.error[50] },
                  camp.status === 'sending' && { backgroundColor: colors.secondary[50] },
                ]}>
                  {camp.status === 'completed' && <CheckCircle2 size={12} color={colors.success[600]} />}
                  <Text style={[
                    styles.recentBadgeText,
                    camp.status === 'completed' && { color: colors.success[700] },
                    camp.status === 'failed' && { color: colors.error[600] },
                    camp.status === 'sending' && { color: colors.secondary[600] },
                  ]}>
                    {camp.status === 'completed' ? 'مكتملة' :
                      camp.status === 'failed' ? 'فاشلة' :
                        camp.status === 'sending' ? 'جارية' : 'مسودة'}
                  </Text>
                </View>
              </View>
              <View style={styles.recentFooter}>
                <Text style={styles.recentDate}>
                  {new Date(camp.created_at).toLocaleDateString('ar', {
                    year: 'numeric', month: 'short', day: 'numeric',
                  })}
                </Text>
                <Text style={styles.recentStats}>
                  {camp.sent_count} / {camp.total_recipients} مرسلة
                  {camp.failed_count > 0 ? ` · ${camp.failed_count} فاشلة` : ''}
                </Text>
              </View>
            </View>
          ))}
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
    gap: spacing.md,
  },
  pressed: { opacity: 0.8 },
  loadErrorCard: {
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.error[50],
    borderWidth: 1,
    borderColor: colors.error[500] + '55',
    borderRadius: 14,
    padding: spacing.md,
  },
  loadErrorText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.error[700],
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  retryButton: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  retryText: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.primary[700],
    writingDirection: 'rtl',
  },
  syncWarningCard: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.warning[500] + '20',
    borderRadius: 14,
    padding: spacing.sm,
  },
  syncWarningText: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.warning[600],
    writingDirection: 'rtl',
  },

  /* ─── الترويسة ─── */
  header: {
    gap: 3,
    paddingHorizontal: spacing.xs / 2,
  },
  headerTop: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brandRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
  },
  brand: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.primary[700],
    writingDirection: 'rtl',
  },
  refreshBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.neutral[100],
    alignItems: 'center',
    justifyContent: 'center',
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

  /* ─── Onboarding ─── */
  onboardingCard: {
    backgroundColor: colors.primary[50],
    borderWidth: 1,
    borderColor: colors.primary[200],
    borderRadius: 20,
    padding: spacing.md,
    gap: spacing.sm,
    alignItems: 'flex-end',
  },
  onboardingIcon: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: colors.primary[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  onboardingTitle: {
    fontFamily: fonts.bold,
    fontSize: 17,
    color: colors.neutral[900],
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  onboardingDesc: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 22,
    color: colors.neutral[600],
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  /* ─── شبكة الإحصائيات ─── */
  statsGrid: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  statCard: {
    width: '48.5%',
    backgroundColor: colors.neutral[0],
    borderRadius: 16,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.neutral[200],
    alignItems: 'flex-end',
    gap: 4,
  },
  statIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  statValue: {
    fontFamily: fonts.bold,
    fontSize: 24,
    color: colors.neutral[900],
  },
  statLabel: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.neutral[500],
    writingDirection: 'rtl',
  },

  /* ─── تنبيه الرسائل الفاشلة ─── */
  alertCard: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.error[50],
    borderWidth: 1,
    borderColor: colors.error[500] + '55',
    borderRadius: 14,
    padding: spacing.sm,
  },
  alertText: {
    flex: 1,
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.error[700],
    writingDirection: 'rtl',
  },

  /* ─── آخر الحملات ─── */
  recentSection: {
    gap: spacing.xs,
  },
  sectionHeaderRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.xs / 2,
  },
  sectionTitle: {
    flex: 1,
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.neutral[900],
    writingDirection: 'rtl',
  },
  recentCard: {
    backgroundColor: colors.neutral[0],
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.neutral[200],
    padding: spacing.sm,
    gap: spacing.xs / 2,
  },
  recentHeader: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  recentTitle: {
    flex: 1,
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.neutral[900],
    writingDirection: 'rtl',
  },
  recentBadge: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.neutral[100],
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  recentBadgeText: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.neutral[600],
  },
  recentFooter: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  recentDate: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.neutral[400],
  },
  recentStats: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.neutral[600],
    writingDirection: 'rtl',
  },
});

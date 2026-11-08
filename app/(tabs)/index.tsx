import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ClipboardList,
  Database,
  FileText,
  Layers,
  Megaphone,
  Plus,
  RefreshCw,
  Send,
  Settings,
  Sparkles,
  TrendingUp,
  Zap,
} from 'lucide-react-native';
import { MenuCard } from '@/components/MenuCard';
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
  const router = useRouter();
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

  const loadDashboard = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const uid = user?.id || 'default';
      setUserEmail(user?.email ?? null);

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
      setRecentCampaigns((campaigns as unknown as Campaign[]).slice(0, 3));
    } catch {
      // Offline fallback: ignore error
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

  const isFirstRun = !loading && stats.totalCampaigns === 0 && stats.totalTemplates === 0;

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
          <View style={styles.onboardingSteps}>
            <Pressable
              onPress={() => router.navigate('/templates')}
              style={({ pressed }) => [styles.onboardingStep, pressed && styles.pressed]}
            >
              <View style={styles.stepNumber}><Text style={styles.stepNumText}>١</Text></View>
              <Text style={styles.stepText}>أنشئ قالب رسالة</Text>
              <ChevronLeft size={16} color={colors.primary[600]} />
            </Pressable>
            <Pressable
              onPress={() => router.navigate('/settings')}
              style={({ pressed }) => [styles.onboardingStep, pressed && styles.pressed]}
            >
              <View style={styles.stepNumber}><Text style={styles.stepNumText}>٢</Text></View>
              <Text style={styles.stepText}>أضف بوابة هدهد في الإعدادات</Text>
              <ChevronLeft size={16} color={colors.primary[600]} />
            </Pressable>
            <Pressable
              onPress={() => router.navigate('/campaigns')}
              style={({ pressed }) => [styles.onboardingStep, pressed && styles.pressed]}
            >
              <View style={styles.stepNumber}><Text style={styles.stepNumText}>٣</Text></View>
              <Text style={styles.stepText}>استيراد الفواتير وأرسل حملتك</Text>
              <ChevronLeft size={16} color={colors.primary[600]} />
            </Pressable>
          </View>
        </View>
      )}

      {/* ───── شبكة الإحصائيات ───── */}
      <View style={styles.statsGrid}>
        {/* رسائل مرسلة */}
        <Pressable
          onPress={() => router.navigate('/campaigns')}
          style={({ pressed }) => [styles.statCard, pressed && styles.pressed]}
        >
          <View style={[styles.statIconWrap, { backgroundColor: colors.primary[50] }]}>
            <Send size={18} color={colors.primary[700]} />
          </View>
          <Text style={styles.statValue}>{loading ? '…' : stats.totalMessagesSent.toLocaleString('ar')}</Text>
          <Text style={styles.statLabel}>رسائل مرسلة</Text>
        </Pressable>

        {/* حملات */}
        <Pressable
          onPress={() => router.navigate('/campaigns')}
          style={({ pressed }) => [styles.statCard, pressed && styles.pressed]}
        >
          <View style={[styles.statIconWrap, { backgroundColor: colors.secondary[50] }]}>
            <Megaphone size={18} color={colors.secondary[600]} />
          </View>
          <Text style={styles.statValue}>{loading ? '…' : stats.totalCampaigns}</Text>
          <Text style={styles.statLabel}>حملات منشأة</Text>
        </Pressable>

        {/* قوالب */}
        <Pressable
          onPress={() => router.navigate('/templates')}
          style={({ pressed }) => [styles.statCard, pressed && styles.pressed]}
        >
          <View style={[styles.statIconWrap, { backgroundColor: colors.success[50] }]}>
            <FileText size={18} color={colors.success[600]} />
          </View>
          <Text style={styles.statValue}>{loading ? '…' : stats.totalTemplates}</Text>
          <Text style={styles.statLabel}>قوالب جاهزة</Text>
        </Pressable>

        {/* سجل المزامنة */}
        <Pressable
          onPress={() => router.navigate('/settings')}
          style={({ pressed }) => [styles.statCard, pressed && styles.pressed]}
        >
          <View style={[styles.statIconWrap, {
            backgroundColor: stats.pendingSync > 0 ? colors.warning[500] + '20' : colors.neutral[100],
          }]}>
            <Database size={18} color={stats.pendingSync > 0 ? colors.warning[600] : colors.neutral[500]} />
          </View>
          <Text style={[styles.statValue, stats.pendingSync > 0 && { color: colors.warning[600], fontSize: 16 }]}>
            {loading ? '…' : stats.pendingSync > 0 ? `${stats.pendingSync}` : '✓'}
          </Text>
          <Text style={styles.statLabel}>{stats.pendingSync > 0 ? 'معلق للمزامنة' : 'متطابق'}</Text>
        </Pressable>
      </View>

      {/* ───── تنبيه الرسائل الفاشلة ───── */}
      {!loading && stats.failedMessages > 0 && (
        <Pressable
          onPress={() => router.navigate('/campaigns')}
          style={({ pressed }) => [styles.alertCard, pressed && styles.pressed]}
        >
          <AlertTriangle size={18} color={colors.error[600]} strokeWidth={2} />
          <Text style={styles.alertText}>
            {`${stats.failedMessages} رسالة فاشلة — اضغط لإعادة المحاولة`}
          </Text>
          <ChevronLeft size={16} color={colors.error[600]} />
        </Pressable>
      )}

      {/* ───── آخر الحملات ───── */}
      {recentCampaigns.length > 0 && (
        <View style={styles.recentSection}>
          <View style={styles.sectionHeaderRow}>
            <TrendingUp size={17} color={colors.primary[700]} strokeWidth={2} />
            <Text style={styles.sectionTitle}>آخر الحملات</Text>
            <Pressable
              onPress={() => router.navigate('/campaigns')}
              style={({ pressed }) => [styles.seeAllBtn, pressed && styles.pressed]}
            >
              <Text style={styles.seeAllText}>عرض الكل</Text>
              <ChevronLeft size={14} color={colors.primary[600]} />
            </Pressable>
          </View>

          {recentCampaigns.map((camp) => (
            <Pressable
              key={camp.id}
              onPress={() => router.navigate('/campaigns')}
              style={({ pressed }) => [styles.recentCard, pressed && styles.pressed]}
            >
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
            </Pressable>
          ))}
        </View>
      )}

      {/* ───── البطاقات الرئيسية ───── */}
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>العمليات الرئيسية</Text>
      </View>

      <View style={styles.cards}>
        <MenuCard
          title="تجهيز وإرسال الحملات"
          description="استيراد الفواتير (Excel/CSV/PDF) ومطابقة المتغيرات الذكية ومعاينة الرسائل"
          Icon={Layers}
          onPress={() => router.navigate('/campaigns')}
        />
        <MenuCard
          title="إدارة القوالب والرسائل"
          description="إنشاء وتعديل واستنساخ قوالب الرسائل مع دعم المتغيرات العربية ومعاينة حية"
          Icon={ClipboardList}
          onPress={() => router.navigate('/templates')}
        />
        <MenuCard
          title="إعدادات البوابات والمزامنة"
          description="إدارة بوابات هدهد، التحكم بسرعة التدفق، المزامنة السحابية، وخادم الـ AI"
          Icon={Settings}
          onPress={() => router.navigate('/settings')}
        />
      </View>
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
  onboardingSteps: {
    width: '100%',
    gap: spacing.xs / 2,
    marginTop: spacing.xs / 2,
  },
  onboardingStep: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.neutral[0],
    borderRadius: 12,
    padding: spacing.xs,
    borderWidth: 1,
    borderColor: colors.primary[200],
  },
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primary[700],
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumText: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: colors.neutral[0],
  },
  stepText: {
    flex: 1,
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.neutral[800],
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
  seeAllBtn: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 2,
  },
  seeAllText: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.primary[600],
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

  /* ─── بطاقات العمليات ─── */
  cards: {
    gap: spacing.sm,
  },
});

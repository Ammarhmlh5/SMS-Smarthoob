import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ArrowLeft,
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
}

export default function MainMenuScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [stats, setStats] = useState<DashboardStats>({
    totalCampaigns: 0,
    totalMessagesSent: 0,
    totalTemplates: 0,
    pendingSync: 0,
  });
  const [recentCampaign, setRecentCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);

  const loadDashboard = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const uid = user?.id || 'default';

      const [campaigns, templates, pendingCount] = await Promise.all([
        database.getCampaigns(uid),
        database.getTemplates(uid),
        database.getPendingSyncCount(),
      ]);

      const sentSum = campaigns.reduce((acc, c) => acc + (c.sent_count || 0), 0);

      setStats({
        totalCampaigns: campaigns.length,
        totalMessagesSent: sentSum,
        totalTemplates: templates.length,
        pendingSync: pendingCount,
      });

      if (campaigns.length > 0) {
        setRecentCampaign(campaigns[0] as unknown as Campaign);
      } else {
        setRecentCampaign(null);
      }
    } catch {
      // Offline fallback: ignore error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.md, paddingBottom: spacing.lg },
      ]}
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <Sparkles size={16} color={colors.primary[600]} />
          <Text style={styles.brand}>هدهد الفواتير — Offline-First</Text>
        </View>
        <Text style={styles.heading}>لوحة التحكم الرئيسية</Text>
        <Text style={styles.subheading}>متابعة الإرسال وإدارة القوالب واستيراد الفواتير</Text>
      </View>

      {/* Stats Grid */}
      <View style={styles.statsGrid}>
        <View style={styles.statCard}>
          <View style={[styles.statIconWrap, { backgroundColor: colors.primary[50] }]}>
            <Send size={18} color={colors.primary[700]} />
          </View>
          <Text style={styles.statValue}>{loading ? '…' : stats.totalMessagesSent}</Text>
          <Text style={styles.statLabel}>رسائل مرسلة</Text>
        </View>

        <View style={styles.statCard}>
          <View style={[styles.statIconWrap, { backgroundColor: colors.secondary[50] }]}>
            <Megaphone size={18} color={colors.secondary[700]} />
          </View>
          <Text style={styles.statValue}>{loading ? '…' : stats.totalCampaigns}</Text>
          <Text style={styles.statLabel}>حملات منشأة</Text>
        </View>

        <View style={styles.statCard}>
          <View style={[styles.statIconWrap, { backgroundColor: colors.success[50] }]}>
            <FileText size={18} color={colors.success[700]} />
          </View>
          <Text style={styles.statValue}>{loading ? '…' : stats.totalTemplates}</Text>
          <Text style={styles.statLabel}>قوالب جاهزة</Text>
        </View>

        <View style={styles.statCard}>
          <View
            style={[
              styles.statIconWrap,
              { backgroundColor: stats.pendingSync > 0 ? colors.warning[500] + '20' : colors.neutral[100] },
            ]}
          >
            <Database
              size={18}
              color={stats.pendingSync > 0 ? colors.warning[600] : colors.neutral[600]}
            />
          </View>
          <Text
            style={[
              styles.statValue,
              stats.pendingSync > 0 && { color: colors.warning[600], fontSize: 16 },
            ]}
          >
            {loading ? '…' : stats.pendingSync > 0 ? `${stats.pendingSync} معلق` : 'متطابق'}
          </Text>
          <Text style={styles.statLabel}>سجل المزامنة</Text>
        </View>
      </View>

      {/* Recent Campaign Highlight (if available) */}
      {recentCampaign ? (
        <View style={styles.recentSection}>
          <View style={styles.sectionHeaderRow}>
            <Layers size={18} color={colors.primary[700]} />
            <Text style={styles.sectionTitle}>آخر حملة نشطة</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.navigate('/campaigns')}
            style={({ pressed }) => [styles.recentCard, pressed && styles.pressed]}
          >
            <View style={styles.recentHeader}>
              <Text style={styles.recentTitle} numberOfLines={1}>
                {recentCampaign.name}
              </Text>
              <View style={styles.recentBadge}>
                <CheckCircle2 size={13} color={colors.success[600]} />
                <Text style={styles.recentBadgeText}>
                  {recentCampaign.sent_count} / {recentCampaign.total_recipients} مرسلة
                </Text>
              </View>
            </View>

            <View style={styles.recentFooter}>
              <Text style={styles.recentDate}>
                {new Date(recentCampaign.created_at).toLocaleDateString('ar', {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                })}
              </Text>
              <View style={styles.recentAction}>
                <Text style={styles.recentActionText}>عرض التفاصيل</Text>
                <ChevronLeft size={16} color={colors.primary[700]} />
              </View>
            </View>
          </Pressable>
        </View>
      ) : null}

      {/* Main Feature Navigation Cards */}
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
          description="إنشاء وتعديل واستنساخ قوالب الرسائل مع دعم المتغيرات العربية"
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
  header: {
    gap: spacing.xs / 2,
    paddingHorizontal: spacing.xs / 2,
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
    fontSize: 14,
    lineHeight: 22,
    color: colors.neutral[500],
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  // Stats Grid
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
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  statValue: {
    fontFamily: fonts.bold,
    fontSize: 22,
    color: colors.neutral[900],
  },
  statLabel: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.neutral[500],
    writingDirection: 'rtl',
  },
  // Recent Campaign
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
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.neutral[900],
    writingDirection: 'rtl',
  },
  recentCard: {
    backgroundColor: colors.neutral[0],
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.primary[200],
    padding: spacing.sm,
    gap: spacing.xs,
  },
  recentHeader: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  recentTitle: {
    flex: 1,
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.neutral[900],
    writingDirection: 'rtl',
  },
  recentBadge: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.success[50],
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  recentBadgeText: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.success[700],
  },
  recentFooter: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: colors.neutral[100],
  },
  recentDate: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.neutral[400],
  },
  recentAction: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 2,
  },
  recentActionText: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.primary[700],
  },
  cards: {
    gap: spacing.sm,
  },
  pressed: {
    opacity: 0.8,
  },
});

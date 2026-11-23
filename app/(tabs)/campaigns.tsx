import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  AlertCircle,
  CheckCircle2,
  Layers,
  Loader2,
  Megaphone,
  Plus,
  RotateCw,
  Search,
  XCircle,
} from 'lucide-react-native';
import { CampaignDetailModal } from '@/components/CampaignDetailModal';
import { fetchCampaigns, resumeCampaign } from '@/lib/campaigns';
import type { Campaign } from '@/lib/campaigns';
import type { CampaignRecipient } from '@/lib/database';
import { colors, fonts, spacing } from '@/constants/theme';

export default function CampaignsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<Campaign['status'] | 'all'>('all');
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setLoadError(null);
    try {
      setCampaigns(await fetchCampaigns());
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'تعذر تحميل الحملات.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const filteredCampaigns = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return campaigns.filter((campaign) => {
      const matchesStatus = statusFilter === 'all' || campaign.status === statusFilter;
      return matchesStatus && (query === '' || campaign.name.toLowerCase().includes(query));
    });
  }, [campaigns, searchQuery, statusFilter]);

  const counts = useMemo(() => ({
    all: campaigns.length,
    sending: campaigns.filter((campaign) => campaign.status === 'sending').length,
    completed: campaigns.filter((campaign) => campaign.status === 'completed').length,
    failed: campaigns.filter((campaign) => campaign.status === 'failed').length,
    draft: campaigns.filter((campaign) => campaign.status === 'draft').length,
  }), [campaigns]);

  const summary = useMemo(() => ({
    sent: campaigns.reduce((total, campaign) => total + campaign.sent_count, 0),
    failed: campaigns.reduce((total, campaign) => total + campaign.failed_count, 0),
  }), [campaigns]);

  const openCreateCampaign = () => {
    router.push('/direct-send?mode=template&campaign=1');
  };

  const handleRetryFailed = (_failedRecipients: CampaignRecipient[]) => {
    setShowDetailModal(false);
    router.push('/direct-send?mode=template&campaign=1');
  };

  const handleResumeCampaign = async (campaign: Campaign) => {
    setShowDetailModal(false);
    try {
      await resumeCampaign(campaign.id);
    } finally {
      await load();
    }
  };

  const renderStatusBadge = (status: Campaign['status']) => {
    const config = {
      draft: { color: colors.neutral[500], bg: colors.neutral[100], label: 'مسودة', Icon: Layers },
      sending: { color: colors.secondary[600], bg: colors.neutral[100], label: 'جاري الإرسال', Icon: Loader2 },
      completed: { color: colors.success[600], bg: colors.success[50], label: 'مكتملة', Icon: CheckCircle2 },
      failed: { color: colors.error[600], bg: colors.error[50], label: 'فاشلة', Icon: XCircle },
    }[status];
    const { color, bg, label, Icon } = config;
    return (
      <View style={[styles.badge, { backgroundColor: bg }]}>
        <Icon size={14} color={color} strokeWidth={2} />
        <Text style={[styles.badgeText, { color }]}>{label}</Text>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={[styles.screen, styles.centered, { paddingTop: insets.top + spacing.md }]}>
        <ActivityIndicator color={colors.primary[700]} size="large" />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.md, paddingBottom: spacing.lg },
      ]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => { void load(true); }}
          tintColor={colors.primary[700]}
        />
      }
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.heading}>الحملات</Text>
          <Text style={styles.subheading}>متابعة حملات الرسائل وإدارة نتائج الإرسال</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="تحديث الحملات"
          onPress={() => { void load(true); }}
          disabled={refreshing}
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
        >
          {refreshing ? (
            <ActivityIndicator size="small" color={colors.primary[700]} />
          ) : (
            <RotateCw size={18} color={colors.primary[700]} strokeWidth={2} />
          )}
        </Pressable>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="إنشاء حملة جديدة"
        onPress={openCreateCampaign}
        style={({ pressed }) => [styles.createButton, pressed && styles.pressed]}
      >
        <Plus size={20} color={colors.neutral[0]} strokeWidth={2.5} />
        <Text style={styles.createButtonText}>إنشاء حملة جديدة</Text>
      </Pressable>

      <View style={styles.overviewStrip}>
        <View style={styles.overviewItem}>
          <Text style={styles.overviewValue}>{counts.all}</Text>
          <Text style={styles.overviewLabel}>حملات</Text>
        </View>
        <View style={styles.overviewDivider} />
        <View style={styles.overviewItem}>
          <Text style={[styles.overviewValue, { color: colors.success[700] }]}>{summary.sent}</Text>
          <Text style={styles.overviewLabel}>تم إرسالها</Text>
        </View>
        <View style={styles.overviewDivider} />
        <View style={styles.overviewItem}>
          <Text style={[styles.overviewValue, { color: summary.failed > 0 ? colors.error[700] : colors.neutral[700] }]}>{summary.failed}</Text>
          <Text style={styles.overviewLabel}>فشلت</Text>
        </View>
      </View>

      {loadError ? (
        <View style={styles.inlineError}>
          <AlertCircle size={16} color={colors.error[600]} strokeWidth={2} />
          <Text style={styles.inlineErrorText}>{loadError}</Text>
          <Pressable onPress={() => { void load(true); }} style={styles.inlineRetryButton}>
            <Text style={styles.inlineRetryText}>إعادة المحاولة</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.card}>
        <View style={styles.sectionHeaderRow}>
          <Layers size={18} color={colors.primary[700]} />
          <Text style={styles.sectionTitle}>الحملات السابقة</Text>
        </View>

        {campaigns.length === 0 ? (
          <View style={styles.emptyState}>
            <Megaphone size={28} color={colors.neutral[400]} strokeWidth={1.8} />
            <Text style={styles.emptyTitle}>لا توجد حملات سابقة</Text>
            <Text style={styles.cardHint}>ابدأ بحملة جديدة، وستظهر نتائجها هنا.</Text>
          </View>
        ) : (
          <>
            <View style={styles.searchRow}>
              <Search size={16} color={colors.neutral[400]} />
              <TextInput
                style={styles.searchInput}
                placeholder="ابحث باسم الحملة..."
                placeholderTextColor={colors.neutral[400]}
                value={searchQuery}
                onChangeText={setSearchQuery}
                textAlign="right"
                returnKeyType="search"
                accessibilityLabel="بحث في الحملات"
              />
              {searchQuery.length > 0 ? (
                <Pressable onPress={() => setSearchQuery('')} accessibilityLabel="مسح البحث">
                  <XCircle size={16} color={colors.neutral[400]} />
                </Pressable>
              ) : null}
            </View>

            <View style={styles.filterTabs}>
              {([
                ['all', 'الكل'],
                ['sending', 'جاري الإرسال'],
                ['completed', 'مكتملة'],
                ['failed', 'فاشلة'],
                ['draft', 'مسودة'],
              ] as [Campaign['status'] | 'all', string][]).map(([key, label]) => (
                <Pressable
                  key={key}
                  onPress={() => setStatusFilter(key)}
                  style={[styles.filterTab, statusFilter === key && styles.filterTabActive]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: statusFilter === key }}
                >
                  <Text style={[styles.filterTabText, statusFilter === key && styles.filterTabTextActive]}>{label}</Text>
                  {counts[key] > 0 ? (
                    <View style={[styles.filterTabBadge, statusFilter === key && styles.filterTabBadgeActive]}>
                      <Text style={[styles.filterTabBadgeText, statusFilter === key && styles.filterTabBadgeTextActive]}>{counts[key]}</Text>
                    </View>
                  ) : null}
                </Pressable>
              ))}
            </View>

            {filteredCampaigns.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.cardHint}>
                  {searchQuery.length > 0 ? `لا توجد حملات تطابق "${searchQuery}"` : 'لا توجد حملات بهذه الحالة'}
                </Text>
              </View>
            ) : filteredCampaigns.map((campaign) => (
              <Pressable
                key={campaign.id}
                accessibilityRole="button"
                accessibilityLabel={`تفاصيل حملة ${campaign.name}`}
                onPress={() => {
                  setSelectedCampaign(campaign);
                  setShowDetailModal(true);
                }}
                style={({ pressed }) => [styles.campaignItem, pressed && styles.pressed]}
              >
                <View style={styles.campaignHeader}>
                  <Text style={styles.campaignName} numberOfLines={1}>{campaign.name}</Text>
                  {renderStatusBadge(campaign.status)}
                </View>
                <View style={styles.campaignStats}>
                  <Text style={styles.campaignStat}>{campaign.sent_count} / {campaign.total_recipients} مرسلة</Text>
                  {campaign.failed_count > 0 ? (
                    <Text style={[styles.campaignStat, { color: colors.error[600] }]}>{campaign.failed_count} فاشلة</Text>
                  ) : null}
                </View>
                <Text style={styles.campaignDate}>
                  {new Date(campaign.created_at).toLocaleDateString('ar', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  })}
                </Text>
              </Pressable>
            ))}
          </>
        )}
      </View>

      <CampaignDetailModal
        campaign={selectedCampaign}
        visible={showDetailModal}
        onClose={() => {
          setShowDetailModal(false);
          setSelectedCampaign(null);
        }}
        onRetryFailed={handleRetryFailed}
        onResumeCampaign={handleResumeCampaign}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.neutral[50] },
  content: { paddingHorizontal: spacing.sm, gap: spacing.sm },
  centered: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.lg },
  header: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xs / 2,
  },
  headerCopy: { flex: 1, gap: 2 },
  heading: { fontFamily: fonts.bold, fontSize: 28, lineHeight: 34, color: colors.neutral[900], textAlign: 'right' },
  subheading: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 24, color: colors.neutral[500], textAlign: 'right' },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.neutral[200],
    backgroundColor: colors.neutral[0],
    alignItems: 'center',
    justifyContent: 'center',
  },
  createButton: {
    height: 48,
    borderRadius: 14,
    backgroundColor: colors.primary[700],
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  createButtonText: { fontFamily: fonts.bold, fontSize: 14, color: colors.neutral[0] },
  overviewStrip: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    minHeight: 68,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.neutral[200],
    backgroundColor: colors.neutral[0],
    paddingHorizontal: spacing.xs,
  },
  overviewItem: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
  overviewValue: { fontFamily: fonts.bold, fontSize: 20, lineHeight: 26, color: colors.neutral[900] },
  overviewLabel: { fontFamily: fonts.regular, fontSize: 11, color: colors.neutral[500] },
  overviewDivider: { width: 1, height: 36, backgroundColor: colors.neutral[200] },
  inlineError: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.xs / 2,
    padding: spacing.sm,
    borderRadius: 12,
    backgroundColor: colors.error[50],
  },
  inlineErrorText: { flex: 1, fontFamily: fonts.regular, fontSize: 12, color: colors.error[700], textAlign: 'right' },
  inlineRetryButton: { minHeight: 36, justifyContent: 'center', paddingHorizontal: spacing.xs },
  inlineRetryText: { fontFamily: fonts.semibold, fontSize: 12, color: colors.error[700] },
  card: {
    backgroundColor: colors.neutral[0],
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.neutral[200],
    padding: spacing.sm,
    gap: spacing.sm,
  },
  sectionHeaderRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.xs / 2 },
  sectionTitle: { fontFamily: fonts.bold, fontSize: 18, lineHeight: 26, color: colors.neutral[900], textAlign: 'right' },
  emptyState: { minHeight: 140, alignItems: 'center', justifyContent: 'center', gap: 6 },
  emptyTitle: { fontFamily: fonts.semibold, fontSize: 14, color: colors.neutral[700] },
  cardHint: { fontFamily: fonts.regular, fontSize: 12, color: colors.neutral[500], textAlign: 'right' },
  searchRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.neutral[50],
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.neutral[200],
    paddingHorizontal: 12,
    height: 42,
  },
  searchInput: { flex: 1, fontFamily: fonts.regular, fontSize: 14, color: colors.neutral[900], padding: 0 },
  filterTabs: { flexDirection: 'row-reverse', gap: 6, flexWrap: 'wrap' },
  filterTab: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.neutral[200],
    backgroundColor: colors.neutral[50],
  },
  filterTabActive: { borderColor: colors.primary[500], backgroundColor: colors.primary[50] },
  filterTabText: { fontFamily: fonts.regular, fontSize: 12, color: colors.neutral[600] },
  filterTabTextActive: { fontFamily: fonts.bold, color: colors.primary[700] },
  filterTabBadge: { minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.neutral[200], alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  filterTabBadgeActive: { backgroundColor: colors.primary[200] },
  filterTabBadgeText: { fontFamily: fonts.bold, fontSize: 10, color: colors.neutral[600] },
  filterTabBadgeTextActive: { color: colors.primary[800] },
  campaignItem: { gap: 4, paddingVertical: spacing.xs, borderTopWidth: 1, borderTopColor: colors.neutral[100] },
  campaignHeader: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' },
  campaignName: { flex: 1, fontFamily: fonts.semibold, fontSize: 14, color: colors.neutral[900], textAlign: 'right' },
  badge: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  badgeText: { fontFamily: fonts.semibold, fontSize: 11 },
  campaignStats: { flexDirection: 'row-reverse', gap: spacing.sm },
  campaignStat: { fontFamily: fonts.regular, fontSize: 12, color: colors.neutral[500] },
  campaignDate: { fontFamily: fonts.regular, fontSize: 11, color: colors.neutral[400], textAlign: 'right' },
  pressed: { opacity: 0.8 },
});

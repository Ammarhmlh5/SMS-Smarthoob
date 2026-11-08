import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Layers,
  Phone,
  RefreshCw,
  Send,
  Users,
  X,
  XCircle,
} from 'lucide-react-native';
import { database } from '@/lib/database';
import type { CampaignRecipient } from '@/lib/database';
import type { Campaign } from '@/lib/campaigns';
import { colors, fonts, spacing } from '@/constants/theme';

type FilterType = 'all' | 'sent' | 'failed' | 'pending';

interface CampaignDetailModalProps {
  campaign: Campaign | null;
  visible: boolean;
  onClose: () => void;
  onRetryFailed?: (failedRecipients: CampaignRecipient[]) => void;
}

export function CampaignDetailModal({
  campaign,
  visible,
  onClose,
  onRetryFailed,
}: CampaignDetailModalProps) {
  const [recipients, setRecipients] = useState<CampaignRecipient[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<FilterType>('all');

  useEffect(() => {
    if (visible && campaign) {
      setLoading(true);
      setFilter('all');
      database
        .getRecipients(campaign.id)
        .then((data) => {
          setRecipients(data);
        })
        .catch(() => {
          setRecipients([]);
        })
        .finally(() => {
          setLoading(false);
        });
    } else {
      setRecipients([]);
    }
  }, [visible, campaign]);

  if (!campaign) return null;

  const filteredRecipients = recipients.filter((r) => {
    if (filter === 'all') return true;
    return r.status === filter;
  });

  const failedRecipients = recipients.filter((r) => r.status === 'failed');

  const renderStatusIcon = (status: CampaignRecipient['status']) => {
    switch (status) {
      case 'sent':
        return <CheckCircle2 size={16} color={colors.success[600]} strokeWidth={2} />;
      case 'failed':
        return <XCircle size={16} color={colors.error[600]} strokeWidth={2} />;
      default:
        return <Clock size={16} color={colors.warning[600]} strokeWidth={2} />;
    }
  };

  const getStatusText = (status: CampaignRecipient['status']) => {
    switch (status) {
      case 'sent':
        return 'تم الإرسال';
      case 'failed':
        return 'فشلت';
      default:
        return 'قيد الانتظار';
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          {/* Header */}
          <View style={styles.header}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="إغلاق"
              onPress={onClose}
              style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
            >
              <X size={20} color={colors.neutral[600]} strokeWidth={2} />
            </Pressable>
            <View style={styles.headerTitleWrap}>
              <Text style={styles.title} numberOfLines={1}>
                {campaign.name}
              </Text>
              <Text style={styles.dateText}>
                {new Date(campaign.created_at).toLocaleDateString('ar', {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </Text>
            </View>
          </View>

          {/* Stats Overview */}
          <View style={styles.statsRow}>
            <View style={[styles.statCard, { borderColor: colors.neutral[200] }]}>
              <Text style={styles.statValue}>{campaign.total_recipients}</Text>
              <Text style={styles.statLabel}>إجمالي المستلمين</Text>
            </View>

            <View style={[styles.statCard, { borderColor: colors.success[100], backgroundColor: colors.success[50] }]}>
              <Text style={[styles.statValue, { color: colors.success[700] }]}>{campaign.sent_count}</Text>
              <Text style={styles.statLabel}>تم بنجاح</Text>
            </View>

            <View style={[styles.statCard, { borderColor: colors.error[100], backgroundColor: colors.error[50] }]}>
              <Text style={[styles.statValue, { color: colors.error[700] }]}>{campaign.failed_count}</Text>
              <Text style={styles.statLabel}>فشل الإرسال</Text>
            </View>
          </View>

          {/* Action: Retry Failed Button */}
          {failedRecipients.length > 0 && onRetryFailed ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => onRetryFailed(failedRecipients)}
              style={({ pressed }) => [styles.retryAllButton, pressed && styles.pressed]}
            >
              <RefreshCw size={16} color={colors.neutral[0]} strokeWidth={2} />
              <Text style={styles.retryAllText}>
                إعادة إرسال الرسائل الفاشلة فقط ({failedRecipients.length} رسالة)
              </Text>
            </Pressable>
          ) : null}

          {/* Filter Pills */}
          <View style={styles.filtersRow}>
            {(
              [
                { id: 'all', label: `الكل (${recipients.length})` },
                { id: 'sent', label: `الناجحة (${campaign.sent_count})` },
                { id: 'failed', label: `الفاشلة (${campaign.failed_count})` },
              ] as const
            ).map((item) => (
              <Pressable
                key={item.id}
                onPress={() => setFilter(item.id)}
                style={[styles.filterPill, filter === item.id && styles.filterPillActive]}
              >
                <Text style={[styles.filterPillText, filter === item.id && styles.filterPillTextActive]}>
                  {item.label}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Recipients List */}
          {loading ? (
            <View style={styles.centered}>
              <ActivityIndicator color={colors.primary[700]} />
              <Text style={styles.loadingText}>جارٍ تحميل تفاصيل المستلمين…</Text>
            </View>
          ) : filteredRecipients.length === 0 ? (
            <View style={styles.centered}>
              <Users size={32} color={colors.neutral[400]} />
              <Text style={styles.emptyText}>لا توجد رسائل مطابقة لهذا التصنيف.</Text>
            </View>
          ) : (
            <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
              {filteredRecipients.map((r) => (
                <View key={r.id} style={styles.recipientItem}>
                  <View style={styles.recipientHeader}>
                    <View style={styles.recipientInfo}>
                      <Text style={styles.recipientName}>{r.subscriber_name || 'بدون اسم'}</Text>
                      <View style={styles.phoneRow}>
                        <Phone size={12} color={colors.neutral[500]} />
                        <Text style={styles.phoneText}>{r.subscriber_phone}</Text>
                      </View>
                    </View>
                    <View style={styles.statusBadge}>
                      {renderStatusIcon(r.status)}
                      <Text style={styles.statusBadgeText}>{getStatusText(r.status)}</Text>
                    </View>
                  </View>

                  {r.message_body ? (
                    <Text style={styles.messagePreview} numberOfLines={2}>
                      {r.message_body}
                    </Text>
                  ) : null}

                  {r.error_message ? (
                    <View style={styles.errorAlert}>
                      <AlertCircle size={14} color={colors.error[600]} />
                      <Text style={styles.errorAlertText}>{r.error_message}</Text>
                    </View>
                  ) : null}
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.neutral[0],
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
    paddingBottom: 24,
  },
  header: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.neutral[200],
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.neutral[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleWrap: {
    flex: 1,
    alignItems: 'flex-end',
    marginRight: spacing.sm,
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: 18,
    color: colors.neutral[900],
    writingDirection: 'rtl',
  },
  dateText: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.neutral[500],
    writingDirection: 'rtl',
  },
  statsRow: {
    flexDirection: 'row-reverse',
    gap: spacing.xs,
    padding: spacing.sm,
  },
  statCard: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    borderRadius: 14,
    borderWidth: 1,
    backgroundColor: colors.neutral[50],
  },
  statValue: {
    fontFamily: fonts.bold,
    fontSize: 20,
    color: colors.neutral[900],
  },
  statLabel: {
    fontFamily: fonts.regular,
    fontSize: 11,
    color: colors.neutral[500],
    writingDirection: 'rtl',
  },
  retryAllButton: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.error[600],
    marginHorizontal: spacing.sm,
    marginBottom: spacing.xs,
    height: 44,
    borderRadius: 12,
  },
  retryAllText: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.neutral[0],
    writingDirection: 'rtl',
  },
  filtersRow: {
    flexDirection: 'row-reverse',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.xs,
  },
  filterPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: colors.neutral[100],
  },
  filterPillActive: {
    backgroundColor: colors.primary[600],
  },
  filterPillText: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.neutral[600],
  },
  filterPillTextActive: {
    color: colors.neutral[0],
  },
  list: {
    maxHeight: 380,
  },
  listContent: {
    paddingHorizontal: spacing.sm,
    gap: spacing.xs,
    paddingBottom: spacing.md,
  },
  recipientItem: {
    padding: spacing.sm,
    borderRadius: 12,
    backgroundColor: colors.neutral[50],
    borderWidth: 1,
    borderColor: colors.neutral[200],
    gap: 6,
  },
  recipientHeader: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  recipientInfo: {
    alignItems: 'flex-end',
    gap: 2,
  },
  recipientName: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.neutral[900],
    writingDirection: 'rtl',
  },
  phoneRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 4,
  },
  phoneText: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.neutral[600],
    writingDirection: 'ltr',
  },
  statusBadge: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 4,
  },
  statusBadgeText: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    color: colors.neutral[600],
  },
  messagePreview: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.neutral[600],
    textAlign: 'right',
    writingDirection: 'rtl',
    backgroundColor: colors.neutral[0],
    padding: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.neutral[200],
  },
  errorAlert: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    padding: 6,
    borderRadius: 6,
    backgroundColor: colors.error[50],
  },
  errorAlertText: {
    fontFamily: fonts.regular,
    fontSize: 11,
    color: colors.error[700],
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  centered: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
    gap: spacing.xs,
  },
  loadingText: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.neutral[500],
  },
  emptyText: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.neutral[500],
  },
  pressed: {
    opacity: 0.8,
  },
});

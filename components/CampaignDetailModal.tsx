import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Download,
  FileSpreadsheet,
  Phone,
  RefreshCw,
  Users,
  X,
  XCircle,
} from 'lucide-react-native';
import { database } from '@/lib/database';
import type { CampaignRecipient } from '@/lib/database';
import type { Campaign } from '@/lib/campaigns';
import { canResumeCampaignQueue } from '@/lib/campaignQueueStatus';
import { isUncertainDeliveryError } from '@/lib/campaignClaimLease';
import { escapeSpreadsheetCsvCell } from '@/lib/csv';
import { colors, fonts, spacing } from '@/constants/theme';

type FilterType = 'all' | 'sent' | 'failed' | 'pending';

interface CampaignDetailModalProps {
  campaign: Campaign | null;
  visible: boolean;
  onClose: () => void;
  onRetryFailed?: (failedRecipients: CampaignRecipient[]) => void;
  onResumeCampaign?: (campaign: Campaign) => void;
}

export function CampaignDetailModal({
  campaign,
  visible,
  onClose,
  onRetryFailed,
  onResumeCampaign,
}: CampaignDetailModalProps) {
  const [recipients, setRecipients] = useState<CampaignRecipient[]>([]);
  const [hasPendingQueue, setHasPendingQueue] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadAttempt, setReloadAttempt] = useState(0);
  const [filter, setFilter] = useState<FilterType>('all');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [confirmingUncertainRetry, setConfirmingUncertainRetry] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (visible && campaign) {
      setLoading(true);
      setLoadError(null);
      setFilter('all');
      setConfirmingUncertainRetry(false);
      Promise.all([
        database.getRecipients(campaign.id),
        database.getCampaignQueueStats(campaign.id),
      ])
        .then(([data, stats]) => {
          if (cancelled) return;
          setRecipients(data);
          setHasPendingQueue(canResumeCampaignQueue(stats));
        }, (error: unknown) => {
          if (cancelled) return;
          setRecipients([]);
          setHasPendingQueue(false);
          setLoadError(
            error instanceof Error ? error.message : 'تعذر تحميل تفاصيل الحملة من قاعدة البيانات.',
          );
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    } else {
      setRecipients([]);
      setHasPendingQueue(false);
      setLoadError(null);
    }
    return () => {
      cancelled = true;
    };
  }, [visible, campaign?.id, reloadAttempt]);

  if (!campaign) return null;

  const filteredRecipients = recipients.filter((r) => {
    if (filter === 'all') return true;
    return r.status === filter;
  });

  const failedRecipients = recipients.filter((r) => r.status === 'failed');
  const uncertainRecipients = failedRecipients.filter((r) =>
    isUncertainDeliveryError(r.error_message),
  );

  const handleExportCSV = async () => {
    if (recipients.length === 0) return;
    setExporting(true);
    setExportError(null);
    try {
      // Header row in Arabic
      const headers = ['رقم الهاتف', 'اسم المستلم', 'الحالة', 'تاريخ الإرسال', 'نص الرسالة', 'سبب الخطأ'];

      // Rows
      const rows = recipients.map((r) => [
        escapeSpreadsheetCsvCell(r.subscriber_phone),
        escapeSpreadsheetCsvCell(r.subscriber_name || ''),
        escapeSpreadsheetCsvCell(
          r.status === 'sent' ? 'تم الإرسال' : r.status === 'failed' ? 'فشلت' : 'قيد الانتظار',
        ),
        escapeSpreadsheetCsvCell(r.sent_at || ''),
        escapeSpreadsheetCsvCell(r.message_body || ''),
        escapeSpreadsheetCsvCell(r.error_message || ''),
      ]);

      // Add UTF-8 BOM so Excel displays Arabic without garbled characters
      const csvContent = '\uFEFF' + [
        headers.map(escapeSpreadsheetCsvCell).join(','),
        ...rows.map((row) => row.join(',')),
      ].join('\r\n');

      if (Platform.OS === 'web') {
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `${campaign.name}_report.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } else {
        await Share.share({
          message: csvContent,
          title: `تقرير حملة ${campaign.name}`,
        });
      }
    } catch (err) {
      console.warn('Failed to export campaign CSV:', err);
      setExportError(
        err instanceof Error ? err.message : 'تعذر تصدير تقرير الحملة. حاول مرة أخرى.',
      );
    } finally {
      setExporting(false);
    }
  };

  const renderStatusIcon = (recipient: CampaignRecipient) => {
    if (isUncertainDeliveryError(recipient.error_message)) {
      return <AlertCircle size={16} color={colors.warning[600]} strokeWidth={2} />;
    }

    const { status } = recipient;
    switch (status) {
      case 'sent':
        return <CheckCircle2 size={16} color={colors.success[600]} strokeWidth={2} />;
      case 'failed':
        return <XCircle size={16} color={colors.error[600]} strokeWidth={2} />;
      default:
        return <Clock size={16} color={colors.warning[600]} strokeWidth={2} />;
    }
  };

  const getStatusText = (recipient: CampaignRecipient) => {
    if (isUncertainDeliveryError(recipient.error_message)) return 'النتيجة غير مؤكدة';

    const { status } = recipient;
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

          {/* Action Buttons Row: Retry Failed & Export CSV */}
          <View style={styles.actionsContainer}>
            {hasPendingQueue && onResumeCampaign ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => onResumeCampaign(campaign)}
                style={({ pressed }) => [styles.retryAllButton, pressed && styles.pressed]}
              >
                <RefreshCw size={15} color={colors.neutral[0]} strokeWidth={2} />
                <Text style={styles.retryAllText}>استكمال الرسائل المتبقية</Text>
              </Pressable>
            ) : null}

            {failedRecipients.length > 0 && onRetryFailed ? (
              confirmingUncertainRetry ? (
                <View style={styles.uncertainRetryNotice}>
                  <Text style={styles.uncertainRetryText}>
                    ستُعاد جميع الرسائل الفاشلة ({failedRecipients.length})، ومنها{' '}
                    {uncertainRecipients.length} بنتيجة غير مؤكدة. تحقق من سجل البوابة لتجنب
                    التكرار.
                  </Text>
                  <View style={styles.uncertainRetryActions}>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => onRetryFailed(failedRecipients)}
                      style={({ pressed }) => [
                        styles.uncertainConfirmButton,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={styles.uncertainConfirmText}>تأكيد إعادة الإرسال</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => setConfirmingUncertainRetry(false)}
                      style={({ pressed }) => [
                        styles.uncertainCancelButton,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={styles.uncertainCancelText}>إلغاء</Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    if (uncertainRecipients.length > 0) {
                      setConfirmingUncertainRetry(true);
                    } else {
                      onRetryFailed(failedRecipients);
                    }
                  }}
                  style={({ pressed }) => [styles.retryAllButton, pressed && styles.pressed]}
                >
                  <RefreshCw size={15} color={colors.neutral[0]} strokeWidth={2} />
                  <Text style={styles.retryAllText}>
                    إعادة إرسال الفاشلة ({failedRecipients.length})
                  </Text>
                </Pressable>
              )
            ) : null}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="تصدير التقرير"
              onPress={handleExportCSV}
              disabled={exporting || recipients.length === 0}
              style={({ pressed }) => [
                styles.exportButton,
                pressed && styles.pressed,
                (exporting || recipients.length === 0) && styles.disabled,
              ]}
            >
              {exporting ? (
                <ActivityIndicator color={colors.primary[700]} size="small" />
              ) : (
                <>
                  <Download size={15} color={colors.primary[700]} strokeWidth={2} />
                  <Text style={styles.exportButtonText}>تصدير التقرير (CSV)</Text>
                </>
              )}
            </Pressable>
          </View>
          {exportError ? (
            <View style={styles.exportError}>
              <AlertCircle size={15} color={colors.error[700]} strokeWidth={2} />
              <Text style={styles.exportErrorText}>{exportError}</Text>
            </View>
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
          ) : loadError ? (
            <View style={styles.centered}>
              <AlertCircle size={28} color={colors.error[600]} />
              <Text style={styles.loadErrorText}>{loadError}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => setReloadAttempt((attempt) => attempt + 1)}
                style={({ pressed }) => [
                  styles.loadRetryButton,
                  pressed && styles.pressed,
                ]}
              >
                <RefreshCw size={14} color={colors.primary[700]} strokeWidth={2} />
                <Text style={styles.loadRetryText}>إعادة تحميل التفاصيل</Text>
              </Pressable>
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
                        {renderStatusIcon(r)}
                        <Text style={styles.statusBadgeText}>{getStatusText(r)}</Text>
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
  actionsContainer: {
    flexDirection: 'row-reverse',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.xs,
  },
  retryAllButton: {
    flex: 1,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.error[600],
    height: 42,
    borderRadius: 12,
  },
  retryAllText: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.neutral[0],
    writingDirection: 'rtl',
  },
  uncertainRetryNotice: {
    flex: 1,
    gap: spacing.xs,
    padding: spacing.sm,
    borderRadius: 12,
    backgroundColor: colors.neutral[50],
    borderWidth: 1,
    borderColor: colors.warning[500],
  },
  uncertainRetryText: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.neutral[800],
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  uncertainRetryActions: {
    flexDirection: 'row-reverse',
    gap: spacing.xs,
  },
  uncertainConfirmButton: {
    flex: 1,
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: colors.error[600],
  },
  uncertainConfirmText: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.neutral[0],
    writingDirection: 'rtl',
  },
  uncertainCancelButton: {
    minHeight: 38,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: colors.neutral[100],
  },
  uncertainCancelText: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.neutral[700],
    writingDirection: 'rtl',
  },
  exportButton: {
    flex: 1,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.primary[200],
    backgroundColor: colors.primary[50],
    height: 42,
    borderRadius: 12,
  },
  exportButtonText: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.primary[700],
    writingDirection: 'rtl',
  },
  exportError: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: spacing.sm,
    marginBottom: spacing.xs,
    padding: spacing.sm,
    borderRadius: 10,
    backgroundColor: colors.error[50],
  },
  exportErrorText: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.error[700],
    textAlign: 'right',
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
  loadErrorText: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.error[700],
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  loadRetryButton: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    minHeight: 38,
    paddingHorizontal: spacing.md,
    borderRadius: 10,
    backgroundColor: colors.primary[50],
    borderWidth: 1,
    borderColor: colors.primary[200],
  },
  loadRetryText: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.primary[700],
  },
  emptyText: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.neutral[500],
  },
  disabled: {
    opacity: 0.5,
  },
  pressed: {
    opacity: 0.8,
  },
});

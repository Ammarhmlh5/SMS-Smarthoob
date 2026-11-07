import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  AlertCircle,
  CheckCircle2,
  Layers,
  Loader2,
  Megaphone,
  Send,
  Users,
  XCircle,
} from 'lucide-react-native';
import { EmptyState } from '@/components/EmptyState';
import { Field, formStyles } from '@/components/FormField';
import { fetchTemplates } from '@/lib/templates';
import type { MessageTemplate } from '@/lib/templates';
import { fetchGatewaySettings } from '@/lib/gatewaySettings';
import type { GatewaySettings } from '@/lib/gatewaySettings';
import {
  fetchCampaigns,
  fetchSubscribers,
  sendCampaign,
} from '@/lib/campaigns';
import type { Campaign, Subscriber } from '@/lib/campaigns';
import { colors, fonts, spacing } from '@/constants/theme';

type Step = 'form' | 'fetching' | 'preview' | 'sending' | 'result';

export default function CampaignsScreen() {
  const insets = useSafeAreaInsets();

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [settings, setSettings] = useState<GatewaySettings | null>(null);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [step, setStep] = useState<Step>('form');
  const [selectedConnection, setSelectedConnection] = useState<string>('');
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');
  const [campaignName, setCampaignName] = useState('');
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [subscribersError, setSubscribersError] = useState<string | null>(null);
  const [sendResult, setSendResult] = useState<{ sent: number; failed: number; total: number } | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [campaignData, settingsData, templateData] = await Promise.all([
        fetchCampaigns(),
        fetchGatewaySettings(),
        fetchTemplates(),
      ]);
      setCampaigns(campaignData);
      setSettings(settingsData);
      setTemplates(templateData);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'تعذر تحميل الحملات.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const hasConnections = settings !== null && settings.connections.length > 0;
  const hasTemplates = templates.length > 0;
  const canStart =
    selectedConnection !== '' && selectedTemplate !== '' && campaignName.trim().length > 0;

  const resetForm = () => {
    setStep('form');
    setSubscribers([]);
    setSubscribersError(null);
    setSendResult(null);
    setSendError(null);
  };

  const handleFetchSubscribers = async () => {
    setStep('fetching');
    setSubscribersError(null);
    try {
      const subs = await fetchSubscribers(selectedConnection);
      setSubscribers(subs);
      setStep('preview');
    } catch (err) {
      setSubscribersError(err instanceof Error ? err.message : 'تعذر جلب المشتركين.');
      setStep('form');
    }
  };

  const handleSend = async () => {
    setStep('sending');
    setSendError(null);
    try {
      const result = await sendCampaign({
        connection_id: selectedConnection,
        template_id: selectedTemplate,
        campaign_name: campaignName,
        batch_size: settings?.batch_size ?? 50,
        max_retries: settings?.max_retries ?? 3,
      });
      setSendResult({ sent: result.sent, failed: result.failed, total: result.total });
      setStep('result');
      load();
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'تعذر إرسال الحملة.');
      setStep('preview');
    }
  };

  const selectedTemplateObj = templates.find((t) => t.id === selectedTemplate);

  const renderStatusBadge = (status: Campaign['status']) => {
    const config = {
      draft: { color: colors.neutral[500], bg: colors.neutral[100], label: 'مسودة', Icon: Layers },
      sending: { color: colors.secondary[600], bg: colors.neutral[100], label: 'جاري الإرسال', Icon: Loader2 },
      completed: { color: colors.success[600], bg: colors.success[500] + '1A', label: 'مكتملة', Icon: CheckCircle2 },
      failed: { color: colors.error[600], bg: colors.error[500] + '1A', label: 'فاشلة', Icon: XCircle },
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
      <View style={[styles.screen, { paddingTop: insets.top + spacing.md }]}>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary[700]} size="large" />
        </View>
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + spacing.md }]}>
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{loadError}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={load}
            style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
          >
            <Text style={styles.retryText}>إعادة المحاولة</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const showEmpty = campaigns.length === 0 && step === 'form';

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.md, paddingBottom: spacing.lg },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <Text style={styles.heading}>الحملات</Text>
        <Text style={styles.subheading}>جهّز حملتك: اختر القالب والخدمة، ثم أرسل لمشتركيك</Text>
      </View>

      {showEmpty && !hasConnections && !hasTemplates ? (
        <View style={styles.emptyWrap}>
          <EmptyState
            Icon={Megaphone}
            title="لا توجد حملات بعد"
            description="أضف خدمة مرتبطة وأنشئ قالباً أولاً، ثم ابدأ حملتك الأولى من هنا"
          />
        </View>
      ) : (
        <>
          {/* New campaign form */}
          {step === 'form' ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>حملة جديدة</Text>

              {!hasConnections ? (
                <View style={styles.noticeBox}>
                  <AlertCircle size={18} color={colors.warning[600]} strokeWidth={2} />
                  <Text style={styles.noticeText}>
                    لا توجد خدمات مرتبطة. أضف خدمة من صفحة الإعدادات أولاً.
                  </Text>
                </View>
              ) : !hasTemplates ? (
                <View style={styles.noticeBox}>
                  <AlertCircle size={18} color={colors.warning[600]} strokeWidth={2} />
                  <Text style={styles.noticeText}>
                    لا توجد قوالب. أنشئ قالباً من تبويب القوالب أولاً.
                  </Text>
                </View>
              ) : null}

              <Field label="اسم الحملة" Icon={Megaphone}>
                <TextInput
                  value={campaignName}
                  onChangeText={setCampaignName}
                  placeholder="مثال: فواتير نوفمبر"
                  placeholderTextColor={colors.neutral[400]}
                  style={formStyles.input}
                />
              </Field>

              <Field label="الخدمة المرتبطة" Icon={Send}>
                <View style={styles.selectWrap}>
                  {settings?.connections.map((conn) => {
                    const selected = selectedConnection === conn.id;
                    return (
                      <Pressable
                        key={conn.id}
                        accessibilityRole="button"
                        onPress={() => setSelectedConnection(conn.id)}
                        style={({ pressed }) => [
                          styles.selectItem,
                          selected && styles.selectItemActive,
                          pressed && styles.pressed,
                        ]}
                      >
                        <View style={styles.selectDot}>
                          {selected ? (
                            <View style={styles.selectDotInner} />
                          ) : null}
                        </View>
                        <View style={styles.selectTextWrap}>
                          <Text style={styles.selectTitle}>{conn.sender_name}</Text>
                          <Text style={styles.selectSub} numberOfLines={1}>
                            {conn.endpoint_url}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </Field>

              <Field label="القالب" Icon={Layers}>
                <View style={styles.selectWrap}>
                  {templates.map((tmpl) => {
                    const selected = selectedTemplate === tmpl.id;
                    return (
                      <Pressable
                        key={tmpl.id}
                        accessibilityRole="button"
                        onPress={() => setSelectedTemplate(tmpl.id)}
                        style={({ pressed }) => [
                          styles.selectItem,
                          selected && styles.selectItemActive,
                          pressed && styles.pressed,
                        ]}
                      >
                        <View style={styles.selectDot}>
                          {selected ? (
                            <View style={styles.selectDotInner} />
                          ) : null}
                        </View>
                        <View style={styles.selectTextWrap}>
                          <Text style={styles.selectTitle}>{tmpl.title}</Text>
                          <Text style={styles.selectSub} numberOfLines={2}>
                            {tmpl.body}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </Field>

              {subscribersError ? (
                <Text style={formStyles.errorText}>{subscribersError}</Text>
              ) : null}

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="جلب المشتركين"
                onPress={handleFetchSubscribers}
                disabled={!canStart}
                style={({ pressed }) => [
                  styles.actionButton,
                  pressed && styles.pressed,
                  !canStart && styles.disabled,
                ]}
              >
                <Users size={18} color={colors.neutral[0]} strokeWidth={2} />
                <Text style={styles.actionText}>جلب المشتركين</Text>
              </Pressable>
            </View>
          ) : null}

          {/* Fetching subscribers */}
          {step === 'fetching' ? (
            <View style={styles.card}>
              <View style={styles.centered}>
                <ActivityIndicator color={colors.primary[700]} size="large" />
                <Text style={styles.loadingText}>جاري جلب المشتركين من هدهد…</Text>
              </View>
            </View>
          ) : null}

          {/* Preview subscribers */}
          {step === 'preview' ? (
            <View style={styles.card}>
              <View style={styles.previewHeader}>
                <Text style={styles.sectionTitle}>مراجعة الحملة</Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={resetForm}
                  style={({ pressed }) => [styles.cancelLink, pressed && styles.pressed]}
                >
                  <Text style={styles.cancelLinkText}>إلغاء</Text>
                </Pressable>
              </View>

              <View style={styles.previewRow}>
                <Text style={styles.previewLabel}>الحملة</Text>
                <Text style={styles.previewValue}>{campaignName}</Text>
              </View>

              {selectedTemplateObj ? (
                <View style={styles.previewRow}>
                  <Text style={styles.previewLabel}>القالب</Text>
                  <Text style={styles.previewValue}>{selectedTemplateObj.title}</Text>
                </View>
              ) : null}

              <View style={styles.previewRow}>
                <Users size={16} color={colors.primary[700]} strokeWidth={2} />
                <Text style={styles.previewValue}>
                  {subscribers.length} مشترك
                </Text>
              </View>

              <View style={styles.subscriberList}>
                {subscribers.slice(0, 5).map((sub, idx) => (
                  <View key={idx} style={styles.subscriberItem}>
                    <Text style={styles.subscriberName} numberOfLines={1}>
                      {sub.name || sub.email}
                    </Text>
                    <Text style={styles.subscriberEmail} numberOfLines={1}>
                      {sub.email}
                    </Text>
                  </View>
                ))}
                {subscribers.length > 5 ? (
                  <Text style={styles.moreText}>
                    و {subscribers.length - 5} مشترك آخر…
                  </Text>
                ) : null}
              </View>

              {sendError ? (
                <Text style={formStyles.errorText}>{sendError}</Text>
              ) : null}

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="إرسال الحملة"
                onPress={handleSend}
                style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}
              >
                <Send size={18} color={colors.neutral[0]} strokeWidth={2} />
                <Text style={styles.actionText}>إرسال الحملة</Text>
              </Pressable>
            </View>
          ) : null}

          {/* Sending */}
          {step === 'sending' ? (
            <View style={styles.card}>
              <View style={styles.centered}>
                <ActivityIndicator color={colors.primary[700]} size="large" />
                <Text style={styles.loadingText}>جاري إرسال الرسائل…</Text>
                <Text style={styles.loadingSubText}>قد يستغرق هذا بعض الوقت حسب عدد المشتركين</Text>
              </View>
            </View>
          ) : null}

          {/* Result */}
          {step === 'result' && sendResult ? (
            <View style={styles.card}>
              <View style={styles.centered}>
                <CheckCircle2 size={48} color={colors.success[600]} strokeWidth={2} />
                <Text style={styles.resultTitle}>تم إرسال الحملة</Text>
                <View style={styles.resultStats}>
                  <View style={styles.resultStat}>
                    <Text style={styles.resultStatValue}>{sendResult.total}</Text>
                    <Text style={styles.resultStatLabel}>إجمالي</Text>
                  </View>
                  <View style={styles.resultStat}>
                    <Text style={[styles.resultStatValue, { color: colors.success[600] }]}>
                      {sendResult.sent}
                    </Text>
                    <Text style={styles.resultStatLabel}>نجح</Text>
                  </View>
                  <View style={styles.resultStat}>
                    <Text style={[styles.resultStatValue, { color: colors.error[600] }]}>
                      {sendResult.failed}
                    </Text>
                    <Text style={styles.resultStatLabel}>فشل</Text>
                  </View>
                </View>
                <Pressable
                  accessibilityRole="button"
                  onPress={resetForm}
                  style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}
                >
                  <Text style={styles.actionText}>حملة جديدة</Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          {/* Past campaigns list */}
          {campaigns.length > 0 ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>الحملات السابقة</Text>
              {campaigns.map((camp) => (
                <View key={camp.id} style={styles.campaignItem}>
                  <View style={styles.campaignHeader}>
                    <Text style={styles.campaignName} numberOfLines={1}>{camp.name}</Text>
                    {renderStatusBadge(camp.status)}
                  </View>
                  <View style={styles.campaignStats}>
                    <Text style={styles.campaignStat}>
                      {camp.sent_count} / {camp.total_recipients} مرسلة
                    </Text>
                    {camp.failed_count > 0 ? (
                      <Text style={[styles.campaignStat, { color: colors.error[600] }]}>
                        {camp.failed_count} فاشلة
                      </Text>
                    ) : null}
                  </View>
                  <Text style={styles.campaignDate}>
                    {new Date(camp.created_at).toLocaleDateString('ar', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

import { TextInput } from 'react-native';

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.neutral[50],
  },
  content: {
    paddingHorizontal: spacing.sm,
    gap: spacing.sm,
  },
  centered: {
    paddingVertical: spacing.md,
    alignItems: 'center',
    gap: spacing.xs,
  },
  header: {
    gap: spacing.xs / 2,
    paddingHorizontal: spacing.xs / 2,
    marginBottom: spacing.xs / 2,
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
  errorBox: {
    gap: spacing.sm,
    alignItems: 'center',
    padding: spacing.lg,
  },
  errorText: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    lineHeight: 21,
    color: colors.error[600],
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  retryButton: {
    paddingHorizontal: spacing.sm,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.primary[200],
    backgroundColor: colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.primary[700],
  },
  emptyWrap: {
    gap: spacing.lg,
  },
  noticeBox: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.xs / 2,
    backgroundColor: colors.warning[500] + '1A',
    borderRadius: 12,
    padding: spacing.sm,
  },
  noticeText: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 21,
    color: colors.neutral[700],
    writingDirection: 'rtl',
  },
  selectWrap: {
    gap: spacing.xs / 2,
  },
  selectItem: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.neutral[200],
    borderRadius: 14,
    padding: spacing.sm,
    backgroundColor: colors.neutral[50],
  },
  selectItemActive: {
    borderColor: colors.primary[500],
    backgroundColor: colors.primary[50],
  },
  selectDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.primary[500],
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectDotInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary[700],
  },
  selectTextWrap: {
    flex: 1,
    gap: 2,
    alignItems: 'flex-end',
  },
  selectTitle: {
    fontFamily: fonts.semibold,
    fontSize: 15,
    lineHeight: 22,
    color: colors.neutral[900],
    writingDirection: 'rtl',
  },
  selectSub: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 18,
    color: colors.neutral[500],
    writingDirection: 'ltr',
  },
  actionButton: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs / 2,
    height: 52,
    borderRadius: 14,
    backgroundColor: colors.primary[700],
  },
  actionText: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.neutral[0],
    writingDirection: 'rtl',
  },
  loadingText: {
    fontFamily: fonts.semibold,
    fontSize: 16,
    color: colors.neutral[700],
    writingDirection: 'rtl',
    marginTop: spacing.xs,
  },
  loadingSubText: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.neutral[500],
    writingDirection: 'rtl',
  },
  previewHeader: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cancelLink: {
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs / 2,
  },
  cancelLinkText: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.error[600],
  },
  previewRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.xs / 2,
  },
  previewLabel: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.neutral[500],
    writingDirection: 'rtl',
  },
  previewValue: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.neutral[900],
    writingDirection: 'rtl',
  },
  subscriberList: {
    gap: spacing.xs / 2,
  },
  subscriberItem: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs / 2,
    borderBottomWidth: 1,
    borderBottomColor: colors.neutral[100],
  },
  subscriberName: {
    flex: 1,
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.neutral[900],
    writingDirection: 'rtl',
  },
  subscriberEmail: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.neutral[500],
    writingDirection: 'ltr',
  },
  moreText: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.neutral[400],
    textAlign: 'center',
    writingDirection: 'rtl',
    paddingVertical: spacing.xs / 2,
  },
  resultTitle: {
    fontFamily: fonts.bold,
    fontSize: 22,
    color: colors.neutral[900],
    writingDirection: 'rtl',
  },
  resultStats: {
    flexDirection: 'row-reverse',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  resultStat: {
    alignItems: 'center',
    gap: 4,
  },
  resultStatValue: {
    fontFamily: fonts.bold,
    fontSize: 28,
    color: colors.neutral[900],
  },
  resultStatLabel: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.neutral[500],
    writingDirection: 'rtl',
  },
  campaignItem: {
    gap: spacing.xs / 2,
    paddingVertical: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.neutral[100],
  },
  campaignHeader: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  campaignName: {
    flex: 1,
    fontFamily: fonts.semibold,
    fontSize: 15,
    lineHeight: 22,
    color: colors.neutral[900],
    writingDirection: 'rtl',
  },
  badge: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.xs / 2,
    paddingVertical: 3,
    borderRadius: 10,
  },
  badgeText: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    lineHeight: 18,
  },
  campaignStats: {
    flexDirection: 'row-reverse',
    gap: spacing.sm,
  },
  campaignStat: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.neutral[500],
    writingDirection: 'rtl',
  },
  campaignDate: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.neutral[400],
    writingDirection: 'rtl',
  },
  pressed: {
    opacity: 0.8,
  },
  disabled: {
    opacity: 0.5,
  },
});

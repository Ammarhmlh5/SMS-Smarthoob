import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  AlertCircle,
  CheckCircle2,
  FileSpreadsheet,
  FileText,
  Layers,
  Loader2,
  Megaphone,
  RotateCw,
  Search,
  Send,
  Upload,
  Users,
  XCircle,
} from 'lucide-react-native';
import { EmptyState } from '@/components/EmptyState';
import { Field, formStyles } from '@/components/FormField';
import { DocumentImportModal } from '@/components/DocumentImportModal';
import { CampaignDetailModal } from '@/components/CampaignDetailModal';
import type { CampaignRecipient } from '@/lib/database';
import { extractPlaceholders, fetchTemplates, renderMessage } from '@/lib/templates';
import type { MessageTemplate } from '@/lib/templates';
import { fetchGatewaySettings } from '@/lib/gatewaySettings';
import type { GatewaySettings } from '@/lib/gatewaySettings';
import {
  fetchCampaigns,
  fetchSubscribers,
  resumeCampaign,
  sendCampaign,
} from '@/lib/campaigns';
import type { Campaign, Subscriber } from '@/lib/campaigns';
import { evaluateSendGate } from '@/lib/sendGuard';
import type { DocumentAnalysis } from '@/lib/documentParser';
import { buildDocumentRecipients } from '@/lib/documentRecipients';
import { colors, fonts, spacing } from '@/constants/theme';

type Step = 'form' | 'fetching' | 'preview' | 'sending' | 'result';
type SubscriberSource = 'file' | 'gateway';

export default function CampaignsScreen() {
  const insets = useSafeAreaInsets();

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [settings, setSettings] = useState<GatewaySettings | null>(null);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [step, setStep] = useState<Step>('form');
  const [subscriberSource, setSubscriberSource] = useState<SubscriberSource>('file');
  const [selectedConnection, setSelectedConnection] = useState<string>('');
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');
  const [campaignName, setCampaignName] = useState('');
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [importedFileName, setImportedFileName] = useState<string | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [subscribersError, setSubscribersError] = useState<string | null>(null);
  const [sendResult, setSendResult] = useState<{ sent: number; failed: number; total: number } | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  // Detail Modal & Retry state
    // بحث وتصفية الحملات السابقة
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<Campaign['status'] | 'all'>('all');

  const [selectedCampaignForDetail, setSelectedCampaignForDetail] = useState<Campaign | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [sendingProgress, setSendingProgress] = useState<{ sent: number; processed: number; total: number }>({
    sent: 0,
    processed: 0,
    total: 0,
  });

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

      // Pre-select first connection & template if available
      if (settingsData && settingsData.connections.length > 0 && !selectedConnection) {
        setSelectedConnection(settingsData.connections[0].id);
      }
      if (templateData.length > 0 && !selectedTemplate) {
        setSelectedTemplate(templateData[0].id);
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'تعذر تحميل الحملات.');
    } finally {
      setLoading(false);
    }
  }, [selectedConnection, selectedTemplate]);

  useEffect(() => {
    load();
  }, [load]);

    // تصفية وبحث الحملات
  const filteredCampaigns = useMemo(() => {
    return campaigns.filter((camp) => {
      const matchesStatus = statusFilter === 'all' || camp.status === statusFilter;
      const q = searchQuery.trim().toLowerCase();
      const matchesSearch = q === '' || camp.name.toLowerCase().includes(q);
      return matchesStatus && matchesSearch;
    });
  }, [campaigns, searchQuery, statusFilter]);

  const hasConnections = settings !== null && settings.connections.length > 0;
  const hasTemplates = templates.length > 0;
  const selectedTemplateObj = templates.find((t) => t.id === selectedTemplate);
  const placeholders = selectedTemplateObj ? extractPlaceholders(selectedTemplateObj.body) : [];

  const canStartGateway =
    selectedConnection !== '' && campaignName.trim().length > 0;

  const resetForm = () => {
    setStep('form');
    setSubscribers([]);
    setImportedFileName(null);
    setSubscribersError(null);
    setSendResult(null);
    setSendError(null);
  };

  const handleFetchSubscribers = async () => {
    setStep('fetching');
    setSubscribersError(null);
    try {
      const subs = await fetchSubscribers(selectedConnection);
      // Map subscribers with rendered message if template exists
      const enrichedSubs: Subscriber[] = subs.map((s) => ({
        ...s,
        message: s.message || (selectedTemplateObj
          ? renderMessage(selectedTemplateObj.body, { الاسم: s.name, name: s.name })
          : undefined),
      }));
      if (enrichedSubs.some((subscriber) => !subscriber.message?.trim())) {
        throw new Error('بعض المشتركين لا يملكون رسالة جاهزة؛ اختر قالباً أو أعد إعداد بيانات البوابة.');
      }
      setSubscribers(enrichedSubs);
      setImportedFileName(null);
      setStep('preview');
    } catch (err) {
      setSubscribersError(err instanceof Error ? err.message : 'تعذر جلب المشتركين.');
      setStep('form');
    }
  };

  const handleDocumentMapped = (mapping: Record<string, string>, doc?: DocumentAnalysis) => {
    if (!doc) {
      setShowImportModal(false);
      return;
    }

    let generatedSubs: Subscriber[];
    try {
      generatedSubs = buildDocumentRecipients({
        columns: doc.columns,
        records: doc.records ?? [],
        rowCount: doc.rowCount,
        mapping,
        suggestedPhoneColumn: doc.suggestedPhoneColumn,
        suggestedNameColumn: doc.suggestedNameColumn,
        templateBody: selectedTemplateObj?.body,
        renderMessage,
      });
    } catch (error) {
      setShowImportModal(false);
      Alert.alert(
        'تعذر تجهيز المستند',
        error instanceof Error ? error.message : 'تعذر تجهيز رسائل المستند.',
      );
      return;
    }

    setSubscribers(generatedSubs);
    setImportedFileName(doc.fileName || 'ملف الفواتير');
    setShowImportModal(false);
    setStep('preview');
  };

  const handleRetryFailed = (failedRecipients: CampaignRecipient[]) => {
    setShowDetailModal(false);
    if (!selectedCampaignForDetail) return;

    const retrySubs: Subscriber[] = failedRecipients.map((r) => ({
      phone: r.subscriber_phone,
      name: r.subscriber_name || '',
      message: r.message_body || '',
    }));

    setSubscribers(retrySubs);
    setCampaignName(`إعادة إرسال: ${selectedCampaignForDetail.name}`);
    if (selectedCampaignForDetail.connection_id) {
      setSelectedConnection(selectedCampaignForDetail.connection_id);
    }
    if (selectedCampaignForDetail.template_id) {
      setSelectedTemplate(selectedCampaignForDetail.template_id);
    }
    setStep('preview');
  };

  const handleResumeCampaign = async (campaign: Campaign) => {
    setShowDetailModal(false);
    setSendingProgress({
      sent: campaign.sent_count,
      processed: campaign.sent_count + campaign.failed_count,
      total: campaign.total_recipients,
    });
    setStep('sending');
    try {
      const result = await resumeCampaign(campaign.id, (progress) => {
        setSendingProgress({
          sent: progress.sent,
          processed: progress.processed,
          total: progress.total,
        });
      });
      setSendingProgress({ sent: result.sent, processed: result.total, total: result.total });
      setSendResult({ sent: result.sent, failed: result.failed, total: result.total });
      setStep('result');
      await load();
    } catch (err) {
      setStep('form');
      Alert.alert(
        'تعذر استكمال الحملة',
        err instanceof Error ? err.message : 'تعذر استكمال الحملة. حاول مرة أخرى.',
      );
      await load();
    }
  };

  const handleSend = async () => {
    setSendingProgress({ sent: 0, processed: 0, total: subscribers.length });
    setStep('sending');
    setSendError(null);
    try {
      const gate = await evaluateSendGate({
        connectionId: selectedConnection,
        recipientsCount: subscribers.length,
      });
      if (!gate.canProceed) throw new Error(gate.message);

      const result = await sendCampaign({
        connection_id: selectedConnection,
        template_id: selectedTemplate || null,
        campaign_name: campaignName,
        batch_size: settings?.batch_size ?? 50,
        max_retries: settings?.max_retries ?? 3,
        recipients: subscribers,
      }, (progress) => {
        setSendingProgress({
          sent: progress.sent,
          processed: progress.processed,
          total: progress.total,
        });
      });
      setSendingProgress({ sent: result.sent, processed: result.total, total: result.total });
      setSendResult({ sent: result.sent, failed: result.failed, total: result.total });
      setStep('result');
      load();
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'تعذر إرسال الحملة.');
      setStep('preview');
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
        <Text style={styles.subheading}>استيراد الفواتير، ربط المتغيرات، وإرسال الرسائل الجماعية</Text>
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
                  placeholder="مثال: فواتير المشتركين لشهر نوفمبر"
                  placeholderTextColor={colors.neutral[400]}
                  style={formStyles.input}
                />
              </Field>

              <Field label="الخدمة المرتبطة (البوابة)" Icon={Send}>
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
                          {selected ? <View style={styles.selectDotInner} /> : null}
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

              <Field label="القالب المعتمد" Icon={Layers}>
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
                          {selected ? <View style={styles.selectDotInner} /> : null}
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

              {/* Source Selector Tabs */}
              <View style={styles.sourceTabsContainer}>
                <Text style={styles.sourceLabel}>مصدر المشتركين:</Text>
                <View style={styles.sourcePills}>
                  <Pressable
                    onPress={() => setSubscriberSource('file')}
                    style={[
                      styles.sourcePill,
                      subscriberSource === 'file' && styles.sourcePillActive,
                    ]}
                  >
                    <FileSpreadsheet
                      size={16}
                      color={subscriberSource === 'file' ? colors.primary[700] : colors.neutral[500]}
                      strokeWidth={2}
                    />
                    <Text
                      style={[
                        styles.sourcePillText,
                        subscriberSource === 'file' && styles.sourcePillTextActive,
                      ]}
                    >
                      استيراد ملف (Excel/CSV/PDF)
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={() => setSubscriberSource('gateway')}
                    style={[
                      styles.sourcePill,
                      subscriberSource === 'gateway' && styles.sourcePillActive,
                    ]}
                  >
                    <Users
                      size={16}
                      color={subscriberSource === 'gateway' ? colors.primary[700] : colors.neutral[500]}
                      strokeWidth={2}
                    />
                    <Text
                      style={[
                        styles.sourcePillText,
                        subscriberSource === 'gateway' && styles.sourcePillTextActive,
                      ]}
                    >
                      جلب من البوابة مباشرة
                    </Text>
                  </Pressable>
                </View>
              </View>

              {subscribersError ? (
                <Text style={formStyles.errorText}>{subscribersError}</Text>
              ) : null}

              {/* Action Buttons depending on Source */}
              {subscriberSource === 'file' ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="استيراد ملف المشتركين"
                  onPress={() => {
                    if (!campaignName.trim()) {
                      setSubscribersError('يرجى إدخال اسم الحملة أولاً');
                      return;
                    }
                    if (!selectedConnection) {
                      setSubscribersError('يرجى اختيار الخدمة المرتبطة');
                      return;
                    }
                    setSubscribersError(null);
                    setShowImportModal(true);
                  }}
                  style={({ pressed }) => [
                    styles.actionButton,
                    styles.importActionButton,
                    pressed && styles.pressed,
                  ]}
                >
                  <Upload size={18} color={colors.neutral[0]} strokeWidth={2} />
                  <Text style={styles.actionText}>
                    {placeholders.length > 0
                      ? `استيراد ملف ومطابقة ${placeholders.length} متغيرات`
                      : 'استيراد ملف الفواتير والمشتركين'}
                  </Text>
                </Pressable>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="جلب المشتركين"
                  onPress={handleFetchSubscribers}
                  disabled={!canStartGateway}
                  style={({ pressed }) => [
                    styles.actionButton,
                    pressed && styles.pressed,
                    !canStartGateway && styles.disabled,
                  ]}
                >
                  <Users size={18} color={colors.neutral[0]} strokeWidth={2} />
                  <Text style={styles.actionText}>جلب المشتركين والمعاينة</Text>
                </Pressable>
              )}
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
                <Text style={styles.sectionTitle}>مراجعة الحملة قبل الإرسال</Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={resetForm}
                  style={({ pressed }) => [styles.cancelLink, pressed && styles.pressed]}
                >
                  <Text style={styles.cancelLinkText}>تعديل / إلغاء</Text>
                </Pressable>
              </View>

              <View style={styles.previewRow}>
                <Text style={styles.previewLabel}>اسم الحملة:</Text>
                <Text style={styles.previewValue}>{campaignName}</Text>
              </View>

              {selectedTemplateObj ? (
                <View style={styles.previewRow}>
                  <Text style={styles.previewLabel}>القالب:</Text>
                  <Text style={styles.previewValue}>{selectedTemplateObj.title}</Text>
                </View>
              ) : null}

              {importedFileName ? (
                <View style={styles.previewRow}>
                  <Text style={styles.previewLabel}>الملف المصدر:</Text>
                  <Text style={[styles.previewValue, { color: colors.primary[700] }]}>
                    📄 {importedFileName}
                  </Text>
                </View>
              ) : null}

              <View style={styles.previewRow}>
                <Text style={styles.previewLabel}>إجمالي المشتركين:</Text>
                <Text style={[styles.previewValue, { fontFamily: fonts.bold, color: colors.primary[700] }]}>
                  {subscribers.length} مشترك
                </Text>
              </View>

              <Text style={styles.previewSubtitle}>معاينة نماذج من الرسائل المخصصة:</Text>

              <View style={styles.subscriberList}>
                {subscribers.slice(0, 4).map((sub, idx) => (
                  <View key={idx} style={styles.subscriberItem}>
                    <View style={styles.subscriberTop}>
                      <Text style={styles.subscriberName} numberOfLines={1}>
                        {sub.name}
                      </Text>
                      <Text style={styles.subscriberPhone} numberOfLines={1}>
                        {sub.phone}
                      </Text>
                    </View>
                    {sub.message ? (
                      <View style={styles.messagePreviewBox}>
                        <Text style={styles.messagePreviewText}>
                          💬 {sub.message}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                ))}

                {subscribers.length > 4 ? (
                  <Text style={styles.moreText}>
                    و {subscribers.length - 4} مشترك آخر سيتم إرسال رسائلهم بنفس الصيغة…
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
                <Text style={styles.actionText}>بدء إرسال الحملة ({subscribers.length} رسالة)</Text>
              </Pressable>
            </View>
          ) : null}

          {/* Sending */}
          {step === 'sending' ? (
            <View style={styles.card}>
              <View style={styles.centered}>
                <ActivityIndicator color={colors.primary[700]} size="large" />
                <Text style={styles.loadingText}>جاري إرسال الرسائل…</Text>
                
                {/* Visual Progress Bar */}
                <View style={styles.progressBarTrack}>
                  <View
                    style={[
                      styles.progressBarFill,
                      {
                        width: `${
                          sendingProgress.total > 0
                            ? Math.min(100, Math.round((sendingProgress.processed / sendingProgress.total) * 100))
                            : 10
                        }%`,
                      },
                    ]}
                  />
                </View>

                <Text style={styles.loadingSubText}>
                  {sendingProgress.processed > 0
                    ? `تمت معالجة ${sendingProgress.processed} من ${sendingProgress.total} رسالة؛ أُرسل بنجاح ${sendingProgress.sent}`
                    : `يتم الإرسال على دفعات (${subscribers.length} رسالة)`}
                </Text>
              </View>
            </View>
          ) : null}

          {/* Result */}
          {step === 'result' && sendResult ? (
            <View style={styles.card}>
              <View style={styles.centered}>
                <CheckCircle2 size={48} color={colors.success[600]} strokeWidth={2} />
                <Text style={styles.resultTitle}>تم الانتهاء من الإرسال</Text>
                <View style={styles.resultStats}>
                  <View style={styles.resultStat}>
                    <Text style={styles.resultStatValue}>{sendResult.total}</Text>
                    <Text style={styles.resultStatLabel}>إجمالي</Text>
                  </View>
                  <View style={styles.resultStat}>
                    <Text style={[styles.resultStatValue, { color: colors.success[600] }]}>
                      {sendResult.sent}
                    </Text>
                    <Text style={styles.resultStatLabel}>تم الإرسال</Text>
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
                  <Text style={styles.actionText}>إنشاء حملة جديدة</Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          {/* قائمة الحملات السابقة مع بحث وتصفية */}
          {campaigns.length > 0 ? (
            <View style={styles.card}>
              {/* رأس القسم */}
              <View style={styles.sectionHeaderRow}>
                <Layers size={18} color={colors.primary[700]} />
                <Text style={styles.sectionTitle}>الحملات السابقة</Text>
              </View>
              <Text style={styles.cardHint}>اضغط على أي حملة لاستعراض تفاصيل المستلمين وإعادة إرسال الفاشلة</Text>

              {/* شريط البحث */}
              <View style={styles.searchRow}>
                <Search size={16} color={colors.neutral[400]} style={styles.searchIcon} />
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

              {/* تبويبات التصفية */}
              <View style={styles.filterTabs}>
                {(
                  [
                    { key: 'all', label: 'الكل', count: campaigns.length },
                    { key: 'completed', label: 'مكتملة', count: campaigns.filter((c) => c.status === 'completed').length },
                    { key: 'failed', label: 'فاشلة', count: campaigns.filter((c) => c.status === 'failed').length },
                    { key: 'draft', label: 'مسودة', count: campaigns.filter((c) => c.status === 'draft').length },
                  ] as { key: Campaign['status'] | 'all'; label: string; count: number }[]
                ).map((tab) => (
                  <Pressable
                    key={tab.key}
                    onPress={() => setStatusFilter(tab.key)}
                    style={[styles.filterTab, statusFilter === tab.key && styles.filterTabActive]}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: statusFilter === tab.key }}
                  >
                    <Text style={[styles.filterTabText, statusFilter === tab.key && styles.filterTabTextActive]}>
                      {tab.label}
                    </Text>
                    {tab.count > 0 ? (
                      <View style={[styles.filterTabBadge, statusFilter === tab.key && styles.filterTabBadgeActive]}>
                        <Text style={[styles.filterTabBadgeText, statusFilter === tab.key && styles.filterTabBadgeTextActive]}>
                          {tab.count}
                        </Text>
                      </View>
                    ) : null}
                  </Pressable>
                ))}
              </View>

              {/* نتائج البحث أو رسالة فارغة */}
              {filteredCampaigns.length === 0 ? (
                <View style={styles.centered}>
                  <Text style={styles.cardHint}>
                    {searchQuery.length > 0
                      ? `لا توجد حملات تطابق "${searchQuery}"`
                      : 'لا توجد حملات بهذه الحالة'}
                  </Text>
                </View>
              ) : (
                filteredCampaigns.map((camp) => (
                  <Pressable
                    key={camp.id}
                    accessibilityRole="button"
                    accessibilityLabel={`تفاصيل حملة ${camp.name}`}
                    onPress={() => {
                      setSelectedCampaignForDetail(camp);
                      setShowDetailModal(true);
                    }}
                    style={({ pressed }) => [styles.campaignItem, pressed && styles.pressed]}
                  >
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
                  </Pressable>
                ))
              )}
            </View>
          ) : null}
        </>
      )}

      {/* Campaign Detail Modal Overlay */}
      <CampaignDetailModal
        campaign={selectedCampaignForDetail}
        visible={showDetailModal}
        onClose={() => {
          setShowDetailModal(false);
          setSelectedCampaignForDetail(null);
        }}
        onRetryFailed={handleRetryFailed}
        onResumeCampaign={handleResumeCampaign}
      />

      {/* Document Import Modal Overlay */}
      <Modal
        visible={showImportModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowImportModal(false)}
      >
        <DocumentImportModal
          variables={placeholders}
          onMapped={handleDocumentMapped}
          onCancel={() => setShowImportModal(false)}
        />
      </Modal>
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
  cardHint: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.neutral[500],
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  progressBarTrack: {
    width: '100%',
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.neutral[200],
    overflow: 'hidden',
    marginVertical: spacing.xs,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: colors.primary[600],
    borderRadius: 4,
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
  noticeBox: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.xs,
    padding: spacing.sm,
    borderRadius: 12,
    backgroundColor: colors.warning[500] + '15',
  },
  noticeText: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 20,
    color: colors.warning[600],
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  emptyWrap: {
    paddingVertical: spacing.lg,
  },
  selectWrap: {
    gap: spacing.xs / 2,
  },
  selectItem: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.xs,
    padding: spacing.xs,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.neutral[200],
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
    borderColor: colors.neutral[300],
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectDotInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary[600],
  },
  selectTextWrap: {
    flex: 1,
    gap: 2,
  },
  selectTitle: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.neutral[900],
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  selectSub: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.neutral[500],
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  sourceTabsContainer: {
    gap: spacing.xs / 2,
    marginTop: spacing.xs / 2,
  },
  sourceLabel: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.neutral[700],
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  sourcePills: {
    flexDirection: 'row-reverse',
    gap: spacing.xs,
  },
  sourcePill: {
    flex: 1,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.neutral[200],
    backgroundColor: colors.neutral[50],
  },
  sourcePillActive: {
    borderColor: colors.primary[600],
    backgroundColor: colors.primary[50],
  },
  sourcePillText: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.neutral[600],
  },
  sourcePillTextActive: {
    fontFamily: fonts.bold,
    color: colors.primary[700],
  },
  actionButton: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs / 2,
    height: 48,
    borderRadius: 14,
    backgroundColor: colors.primary[600],
    marginTop: spacing.xs,
  },
  importActionButton: {
    backgroundColor: colors.primary[700],
  },
  actionText: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.neutral[0],
  },
  previewHeader: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cancelLink: {
    padding: spacing.xs / 2,
  },
  cancelLinkText: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.error[600],
  },
  previewRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.neutral[100],
  },
  previewLabel: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.neutral[500],
  },
  previewValue: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.neutral[900],
  },
  previewSubtitle: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: colors.neutral[700],
    textAlign: 'right',
    writingDirection: 'rtl',
    marginTop: spacing.xs,
  },
  subscriberList: {
    gap: spacing.xs,
  },
  subscriberItem: {
    backgroundColor: colors.neutral[50],
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.neutral[200],
    padding: spacing.xs,
    gap: 4,
  },
  subscriberTop: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  subscriberName: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.neutral[900],
    textAlign: 'right',
  },
  subscriberPhone: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.neutral[500],
    writingDirection: 'ltr',
  },
  messagePreviewBox: {
    backgroundColor: colors.neutral[0],
    borderRadius: 8,
    padding: 8,
    borderWidth: 1,
    borderColor: colors.primary[100],
  },
  messagePreviewText: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 18,
    color: colors.neutral[700],
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  moreText: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.neutral[400],
    textAlign: 'center',
    writingDirection: 'rtl',
    paddingVertical: 4,
  },
  loadingText: {
    fontFamily: fonts.semibold,
    fontSize: 15,
    color: colors.neutral[900],
  },
  loadingSubText: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.neutral[500],
  },
  resultTitle: {
    fontFamily: fonts.bold,
    fontSize: 20,
    color: colors.neutral[900],
    marginTop: spacing.xs,
  },
  resultStats: {
    flexDirection: 'row-reverse',
    gap: spacing.lg,
    paddingVertical: spacing.sm,
  },
  resultStat: {
    alignItems: 'center',
    gap: 2,
  },
  resultStatValue: {
    fontFamily: fonts.bold,
    fontSize: 26,
    color: colors.neutral[900],
  },
  resultStatLabel: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.neutral[500],
  },
  campaignItem: {
    gap: 4,
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
    fontSize: 14,
    color: colors.neutral[900],
    textAlign: 'right',
  },
  badge: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  badgeText: {
    fontFamily: fonts.semibold,
    fontSize: 11,
  },
  campaignStats: {
    flexDirection: 'row-reverse',
    gap: spacing.sm,
  },
  campaignStat: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.neutral[500],
  },
  campaignDate: {
    fontFamily: fonts.regular,
    fontSize: 11,
    color: colors.neutral[400],
    textAlign: 'right',
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
    fontSize: 13,
    color: colors.primary[700],
  },
  errorBox: {
    gap: spacing.sm,
    alignItems: 'center',
    padding: spacing.lg,
  },
  errorText: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.error[600],
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.8,
  },
  disabled: {
    opacity: 0.5,
  },
  // ── بحث وتصفية الحملات ──────────────────────────────
  searchRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.neutral[50],
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.neutral[200],
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  searchIcon: {
    flexShrink: 0,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.neutral[900],
    padding: 0,
    writingDirection: 'rtl',
  },
  filterTabs: {
    flexDirection: 'row-reverse',
    gap: 6,
    flexWrap: 'wrap',
  },
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
  filterTabActive: {
    borderColor: colors.primary[500],
    backgroundColor: colors.primary[50],
  },
  filterTabText: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.neutral[600],
  },
  filterTabTextActive: {
    fontFamily: fonts.bold,
    color: colors.primary[700],
  },
  filterTabBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.neutral[200],
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  filterTabBadgeActive: {
    backgroundColor: colors.primary[200],
  },
  filterTabBadgeText: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: colors.neutral[600],
  },
  filterTabBadgeTextActive: {
    color: colors.primary[800],
  },
});

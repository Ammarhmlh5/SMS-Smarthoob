import { useCallback, useEffect, useState } from 'react';
import {
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
  Send,
  Upload,
  Users,
  XCircle,
} from 'lucide-react-native';
import { EmptyState } from '@/components/EmptyState';
import { Field, formStyles } from '@/components/FormField';
import { DocumentImportModal } from '@/components/DocumentImportModal';
import { extractPlaceholders, fetchTemplates, renderMessage } from '@/lib/templates';
import type { MessageTemplate } from '@/lib/templates';
import { fetchGatewaySettings } from '@/lib/gatewaySettings';
import type { GatewaySettings } from '@/lib/gatewaySettings';
import {
  fetchCampaigns,
  fetchSubscribers,
  sendCampaign,
} from '@/lib/campaigns';
import type { Campaign, Subscriber } from '@/lib/campaigns';
import type { DocumentAnalysis } from '@/lib/documentParser';
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

  const hasConnections = settings !== null && settings.connections.length > 0;
  const hasTemplates = templates.length > 0;
  const selectedTemplateObj = templates.find((t) => t.id === selectedTemplate);
  const placeholders = selectedTemplateObj ? extractPlaceholders(selectedTemplateObj.body) : [];

  const canStartGateway =
    selectedConnection !== '' && selectedTemplate !== '' && campaignName.trim().length > 0;

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
        phone: s.email, // In SMS gateway, email field holds the phone/address
        message: selectedTemplateObj
          ? renderMessage(selectedTemplateObj.body, { الاسم: s.name, name: s.name })
          : undefined,
      }));
      setSubscribers(enrichedSubs);
      setImportedFileName(null);
      setStep('preview');
    } catch (err) {
      setSubscribersError(err instanceof Error ? err.message : 'تعذر جلب المشتركين.');
      setStep('form');
    }
  };

  const handleDocumentMapped = (mapping: Record<string, string>, doc?: DocumentAnalysis) => {
    if (!doc || !selectedTemplateObj) {
      setShowImportModal(false);
      return;
    }

    const records = doc.records || doc.columnInfo && Object.keys(doc.columnInfo).length > 0
      ? (doc.records && doc.records.length > 0 ? doc.records : [])
      : [];

    // Identify phone column
    const phoneCol =
      doc.suggestedPhoneColumn ||
      mapping['الجوال'] ||
      mapping['الهاتف'] ||
      mapping['phone'] ||
      mapping['mobile'] ||
      doc.columns.find((c) => /هاتف|جوال|phone|mobile|واتساب/i.test(c)) ||
      doc.columns[0];

    // Identify name column
    const nameCol =
      doc.suggestedNameColumn ||
      mapping['الاسم'] ||
      mapping['اسم'] ||
      mapping['name'] ||
      mapping['client'] ||
      mapping['customer'] ||
      doc.columns.find((c) => /اسم|name|عميل|مشترك/i.test(c));

    let generatedSubs: Subscriber[] = [];

    if (records.length > 0) {
      generatedSubs = records.map((row, idx) => {
        const phone = row[phoneCol] || '';
        const name = nameCol && row[nameCol] ? row[nameCol] : `مشترك ${idx + 1}`;

        // Map variables to values
        const rowDataForTemplate: Record<string, string> = { ...row };
        for (const [varName, colName] of Object.entries(mapping)) {
          if (colName && row[colName] !== undefined) {
            rowDataForTemplate[varName] = row[colName];
          }
        }

        const message = renderMessage(selectedTemplateObj.body, rowDataForTemplate);
        return {
          phone,
          name,
          message,
          data: rowDataForTemplate,
        };
      });
    } else {
      // If document row records were not directly returned (e.g. backend cloud summary),
      // create sample recipient representation based on rowCount
      const count = doc.rowCount || 5;
      for (let i = 0; i < count; i++) {
        const name = `عميل ${i + 1}`;
        const phone = `96655000000${i + 1}`;
        const mockData: Record<string, string> = { الاسم: name, name };
        for (const [v, c] of Object.entries(mapping)) {
          mockData[v] = `[${c}]`;
        }
        generatedSubs.push({
          phone,
          name,
          message: renderMessage(selectedTemplateObj.body, mockData),
          data: mockData,
        });
      }
    }

    setSubscribers(generatedSubs);
    setImportedFileName(doc.fileName || 'ملف الفواتير');
    setShowImportModal(false);
    setStep('preview');
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
        recipients: subscribers,
      });
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
                    if (!selectedTemplate) {
                      setSubscribersError('يرجى اختيار القالب أولاً لربط المتغيرات به');
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
                        {sub.phone || sub.email}
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
                <Text style={styles.loadingSubText}>يتم الإرسال على دفعات مع مراعاة معدل الإرسال</Text>
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

          {/* Past campaigns list */}
          {campaigns.length > 0 ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>الحملات السابقة (سجل المزامنة المحلي)</Text>
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
});

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ArrowRight,
  CheckCircle2,
  FileSpreadsheet,
  Layers,
  MessageSquareText,
  Send,
  XCircle,
} from 'lucide-react-native';
import { DocumentImportModal } from '@/components/DocumentImportModal';
import { Field } from '@/components/FormField';
import { colors, fonts, spacing } from '@/constants/theme';
import { useShareIntentContext } from 'expo-share-intent';
import { pickDocument } from '@/lib/documentParser';
import { fetchGatewaySettings } from '@/lib/gatewaySettings';
import type { GatewaySettings } from '@/lib/gatewaySettings';
import { extractPlaceholders, fetchTemplates, renderMessage } from '@/lib/templates';
import type { MessageTemplate } from '@/lib/templates';
import type { DocumentAnalysis } from '@/lib/documentParser';
import { buildDocumentRecipients } from '@/lib/documentRecipients';
import type { DocumentMessageMode, DocumentRecipientMapping } from '@/lib/documentRecipients';
import { sendDirectMessages } from '@/lib/directSend';
import type { DirectSendRecipient, DirectSendResult } from '@/lib/directSend';
import { sendCampaign } from '@/lib/campaigns';

const DEFAULT_CONNECTION_REQUIRED_MESSAGE = 'اضبط خدمة الإرسال الافتراضية من الإعدادات أولاً.';

type SendStep = 'setup' | 'preview' | 'sending' | 'result';

export default function DirectSendScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: string; campaign?: string }>();
  const isCampaignFlow = params.campaign === '1';
  const preferredMode = params.mode === 'template' ? 'template' : null;
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  const handledShareIntent = useRef(false);
  const [gatewaySettings, setGatewaySettings] = useState<GatewaySettings | null>(null);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [messageMode, setMessageMode] = useState<DocumentMessageMode | null>(preferredMode);
  const [recipients, setRecipients] = useState<DirectSendRecipient[]>([]);
  const [sourceName, setSourceName] = useState('');
  const [step, setStep] = useState<SendStep>('setup');
  const [showImportModal, setShowImportModal] = useState(false);
  const [sharedFile, setSharedFile] = useState<{ uri: string; name: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [pickingDocument, setPickingDocument] = useState(false);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [sendResult, setSendResult] = useState<DirectSendResult | null>(null);
  const [progress, setProgress] = useState({ sent: 0, failed: 0, processed: 0, total: 0 });
  const [campaignName, setCampaignName] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [settingsResult, templateResult] = await Promise.allSettled([
        fetchGatewaySettings(),
        fetchTemplates(),
      ]);

      if (settingsResult.status === 'fulfilled') {
        setGatewaySettings(settingsResult.value);
      } else {
        setGatewaySettings(null);
      }

      if (templateResult.status !== 'fulfilled') {
        throw templateResult.reason instanceof Error
          ? templateResult.reason
          : new Error('تعذر تحميل القوالب.');
      }

      const templateList = templateResult.value;
      setTemplates(templateList);
      if (isCampaignFlow) setMessageMode('template');
      setSelectedTemplate((current) => {
        if (templateList.some((template) => template.id === current)) return current;
        return (templateList.find((template) => template.is_default) ?? templateList[0])?.id ?? '';
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'تعذر تحميل بيانات الإرسال المباشر.');
    } finally {
      setLoading(false);
    }
  }, [isCampaignFlow]);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  useEffect(() => {
    if (!hasShareIntent) {
      handledShareIntent.current = false;
      return;
    }
    const file = shareIntent.files?.[0];
    if (!file || handledShareIntent.current) return;
    handledShareIntent.current = true;
    setSharedFile({ uri: file.path, name: file.fileName });
    resetShareIntent();
  }, [hasShareIntent, shareIntent.files, resetShareIntent]);

  useEffect(() => {
    if (!sharedFile || !messageMode) return;
    const openImportTimer = setTimeout(() => setShowImportModal(true), 0);
    return () => clearTimeout(openImportTimer);
  }, [messageMode, sharedFile]);

  const selectedTemplateObject = templates.find((template) => template.id === selectedTemplate);
  const placeholders = useMemo(
    () => selectedTemplateObject ? extractPlaceholders(selectedTemplateObject.body) : [],
    [selectedTemplateObject],
  );
  const canImportDocument =
    messageMode === 'prepared' || (messageMode === 'template' && Boolean(selectedTemplateObject));
  const handleSelectDocument = async () => {
    setError(null);
    setPickingDocument(true);
    try {
      const file = await pickDocument();
      if (!file) return;
      setSharedFile(file);
    } catch (pickError) {
      setError(pickError instanceof Error ? pickError.message : 'تعذر اختيار المستند.');
    } finally {
      setPickingDocument(false);
    }
  };

  const handleDocumentMapped = useCallback((
    mapping: Record<string, string>,
    document?: DocumentAnalysis,
    recipientMapping?: DocumentRecipientMapping,
  ) => {
    if (!document) {
      setShowImportModal(false);
      setSharedFile(null);
      return;
    }
    try {
      const mappedRecipients = buildDocumentRecipients({
        columns: document.columns,
        records: document.records ?? [],
        rowCount: document.rowCount,
        mapping,
        recipientMapping,
        suggestedPhoneColumn: document.suggestedPhoneColumn,
        suggestedNameColumn: document.suggestedNameColumn,
        templateBody: selectedTemplateObject?.body,
        renderMessage,
      });
      setRecipients(mappedRecipients);
      setSourceName(document.fileName);
      setSendResult(null);
      setStep('preview');
      setShowImportModal(false);
      setSharedFile(null);
      setError(null);
    } catch (mappingError) {
      setShowImportModal(false);
      setSharedFile(null);
      Alert.alert(
        'تعذر تجهيز المستند',
        mappingError instanceof Error ? mappingError.message : 'تعذر تجهيز الرسائل.',
      );
    }
  }, [selectedTemplateObject]);

  const executeSend = useCallback(async (targetRecipients: DirectSendRecipient[]) => {
    if (sendingRef.current) throw new Error('هناك عملية إرسال قيد التنفيذ بالفعل.');
    if (isCampaignFlow && !campaignName.trim()) {
      throw new Error('أدخل اسم الحملة قبل الإرسال.');
    }
    sendingRef.current = true;
    setSending(true);
    setError(null);
    setProgress({ sent: 0, failed: 0, processed: 0, total: targetRecipients.length });
    setStep('sending');
    try {
      const currentGatewaySettings = await fetchGatewaySettings();
      setGatewaySettings(currentGatewaySettings);
      const defaultConnectionId = currentGatewaySettings.default_connection_id;
      if (!defaultConnectionId) {
        throw new Error(DEFAULT_CONNECTION_REQUIRED_MESSAGE);
      }

      let sendResultValue: DirectSendResult;
      if (isCampaignFlow) {
        const campaignResult = await sendCampaign({
          connection_id: defaultConnectionId,
          template_id: selectedTemplate || null,
          campaign_name: campaignName.trim(),
          batch_size: currentGatewaySettings.batch_size,
          max_retries: currentGatewaySettings.max_retries,
          recipients: targetRecipients,
        }, setProgress);
        sendResultValue = {
          total: campaignResult.total,
          sent: campaignResult.sent,
          failed: campaignResult.failed,
          recipients: [],
        };
      } else {
        sendResultValue = await sendDirectMessages(defaultConnectionId, targetRecipients, setProgress);
      }
      setSendResult(sendResultValue);
      setStep('result');
      return sendResultValue;
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }, [isCampaignFlow, campaignName, selectedTemplate]);

  const handleSend = async () => {
    try {
      await executeSend(recipients);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'تعذر تنفيذ الإرسال المباشر.');
      setStep('preview');
    }
  };

  const handlePreparedDirectSend = useCallback(async (
    mapping: Record<string, string>,
    document: DocumentAnalysis,
    recipientMapping: DocumentRecipientMapping,
  ) => {
    const mappedRecipients = buildDocumentRecipients({
      columns: document.columns,
      records: document.records ?? [],
      rowCount: document.rowCount,
      mapping,
      recipientMapping,
      suggestedPhoneColumn: document.suggestedPhoneColumn,
      suggestedNameColumn: document.suggestedNameColumn,
      templateBody: selectedTemplateObject?.body,
      renderMessage,
    });

    setRecipients(mappedRecipients);
    setSourceName(document.fileName);
    setSendResult(null);
    try {
      await executeSend(mappedRecipients);
      setShowImportModal(false);
      setSharedFile(null);
    } catch (sendError) {
      setStep('setup');
      throw sendError;
    }
  }, [executeSend, selectedTemplateObject]);

  const handleCancelImport = () => {
    if (sending) return;
    setShowImportModal(false);
    setSharedFile(null);
  };

  const handleOpenGatewaySettings = () => {
    if (sending) return;
    handleCancelImport();
    router.push('/(tabs)/settings');
  };

  const resetDirectSend = () => {
    setStep('setup');
    setRecipients([]);
    setSourceName('');
    setSendResult(null);
    setProgress({ sent: 0, failed: 0, processed: 0, total: 0 });
    setError(null);
    if (isCampaignFlow) setCampaignName('');
  };

  if (loading) {
    return (
      <View style={[styles.screen, styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator color={colors.primary[700]} size="large" />
        <Text style={styles.mutedText}>جاري تجهيز الإرسال المباشر…</Text>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.sm }]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: spacing.lg + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isCampaignFlow ? 'العودة إلى الحملات' : 'العودة إلى لوحة التحكم'}
            onPress={() => {
              if (isCampaignFlow) {
                router.replace('/(tabs)/campaigns');
              } else {
                router.back();
              }
            }}
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
          >
            <ArrowRight size={20} color={colors.neutral[700]} />
          </Pressable>
          <View style={styles.headerCopy}>
            <Text style={styles.title}>{isCampaignFlow ? 'إنشاء حملة جديدة' : 'إرسال مباشر'}</Text>
            <Text style={styles.subtitle}>
              {isCampaignFlow
                ? 'اختر القالب، أدخل اسم الحملة، ثم جهّز المستند للإرسال'
                : 'اختر نوع الرسائل، ثم جهّز المستند للمعاينة والإرسال'}
            </Text>
          </View>
        </View>

        {error ? (
          <View style={styles.errorBox}>
            <XCircle size={18} color={colors.error[600]} />
            <Text style={styles.errorText}>{error}</Text>
            {error === DEFAULT_CONNECTION_REQUIRED_MESSAGE ? (
              <Pressable onPress={() => router.push('/(tabs)/settings')} style={styles.settingsLink}>
                <Text style={styles.settingsLinkText}>فتح الإعدادات</Text>
              </Pressable>
            ) : !gatewaySettings ? (
              <Pressable onPress={() => void load()} style={styles.settingsLink}>
                <Text style={styles.settingsLinkText}>إعادة المحاولة</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {isCampaignFlow && step === 'setup' ? (
          <View style={styles.campaignNameField}>
            <Text style={styles.fieldLabel}>اسم الحملة</Text>
            <TextInput
              value={campaignName}
              onChangeText={setCampaignName}
              placeholder="مثال: فواتير شهر نوفمبر"
              placeholderTextColor={colors.neutral[400]}
              style={styles.campaignNameInput}
            />
          </View>
        ) : null}

        {step === 'setup' && !isCampaignFlow ? (
          <View style={styles.modeSection}>
            <Text style={styles.sectionTitle}>اختر نوع الرسائل</Text>
            <View style={styles.optionList}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: messageMode === 'prepared' }}
                onPress={() => setMessageMode('prepared')}
                style={({ pressed }) => [
                  styles.option,
                  messageMode === 'prepared' && styles.optionSelected,
                  pressed && styles.pressed,
                ]}
              >
                <MessageSquareText size={20} color={colors.primary[700]} />
                <View style={styles.optionCopy}>
                  <Text style={styles.optionTitle}>رسائل جاهزة</Text>
                  <Text style={styles.optionSub}>نص كامل لكل مستلم في عمود داخل المستند</Text>
                </View>
                <View style={[styles.radio, messageMode === 'prepared' && styles.radioSelected]} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: messageMode === 'template' }}
                onPress={() => setMessageMode('template')}
                style={({ pressed }) => [
                  styles.option,
                  messageMode === 'template' && styles.optionSelected,
                  pressed && styles.pressed,
                ]}
              >
                <Layers size={20} color={colors.primary[700]} />
                <View style={styles.optionCopy}>
                  <Text style={styles.optionTitle}>رسائل القوالب</Text>
                  <Text style={styles.optionSub}>إنشاء الرسائل من قالب محفوظ وأعمدة المستند</Text>
                </View>
                <View style={[styles.radio, messageMode === 'template' && styles.radioSelected]} />
              </Pressable>
            </View>
          </View>
        ) : null}

        {step === 'setup' && messageMode === 'template' ? (
          templates.length ? (
            <Field label="اختر القالب" Icon={Layers}>
              <View style={styles.optionList}>
                {templates.map((template) => {
                  const selected = selectedTemplate === template.id;
                  return (
                    <Pressable
                      key={template.id}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      onPress={() => setSelectedTemplate(template.id)}
                      style={({ pressed }) => [
                        styles.option,
                        selected && styles.optionSelected,
                        pressed && styles.pressed,
                      ]}
                    >
                      <View style={[styles.radio, selected && styles.radioSelected]} />
                      <View style={styles.optionCopy}>
                        <Text style={styles.optionTitle}>{template.title}</Text>
                        <Text style={styles.optionSub}>{template.body}</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </Field>
          ) : (
            <View style={styles.noticeBox}>
              <Text style={styles.noticeText}>لا توجد قوالب محفوظة. أنشئ قالباً أولاً للمتابعة بهذا المسار.</Text>
              <Pressable onPress={() => router.push('/(tabs)/templates')} style={styles.settingsLink}>
                <Text style={styles.settingsLinkText}>فتح القوالب</Text>
              </Pressable>
            </View>
          )
        ) : null}

        {step === 'setup' && messageMode ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="اختيار مستند من الجهاز للإرسال المباشر"
            onPress={() => void handleSelectDocument()}
            disabled={pickingDocument || !canImportDocument}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.pressed,
              (pickingDocument || !canImportDocument) && styles.disabled,
            ]}
          >
            {pickingDocument ? (
              <ActivityIndicator color={colors.neutral[0]} />
            ) : (
              <>
                <FileSpreadsheet size={19} color={colors.neutral[0]} />
                <Text style={styles.primaryButtonText}>اختيار مستند من الجهاز</Text>
              </>
            )}
          </Pressable>
        ) : null}

        {step === 'preview' ? (
          <View style={styles.section}>
            <View style={styles.sectionHeading}>
              <MessageSquareText size={18} color={colors.primary[700]} />
              <Text style={styles.sectionTitle}>معاينة قبل الإرسال</Text>
            </View>
            {sourceName ? <Text style={styles.sourceName}>المستند: {sourceName}</Text> : null}
            <Text style={styles.mutedText}>
              {recipients.length} رسالة جاهزة للإرسال
            </Text>
            <View style={styles.previewList}>
              {recipients.map((recipient, index) => (
                <View key={`${recipient.phone}-${index}`} style={styles.previewItem}>
                  <View style={styles.previewTop}>
                    <Text style={styles.optionTitle}>{recipient.name}</Text>
                    <Text style={styles.phone}>{recipient.phone}</Text>
                  </View>
                  <Text style={styles.messageText}>{recipient.message}</Text>
                </View>
              ))}
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={handleSend}
              disabled={sending || recipients.length === 0}
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && styles.pressed,
                (sending || recipients.length === 0) && styles.disabled,
              ]}
            >
              <Send size={18} color={colors.neutral[0]} />
              <Text style={styles.primaryButtonText}>إرسال مباشر ({recipients.length})</Text>
            </Pressable>
            <Pressable onPress={resetDirectSend} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>اختيار مستند آخر</Text>
            </Pressable>
          </View>
        ) : null}

        {step === 'sending' ? (
          <View style={[styles.section, styles.centered]}>
            <ActivityIndicator color={colors.primary[700]} size="large" />
            <Text style={styles.sectionTitle}>
              {isCampaignFlow ? 'جاري إرسال الحملة' : 'جاري الإرسال المباشر'}
            </Text>
            <Text style={styles.mutedText}>
              تمت معالجة {progress.processed} من {progress.total}، نجح {progress.sent} وتعذر {progress.failed}
            </Text>
          </View>
        ) : null}

        {step === 'result' && sendResult ? (
          <View style={styles.section}>
            <View style={styles.sectionHeading}>
              <CheckCircle2 size={20} color={sendResult.failed ? colors.warning[600] : colors.success[600]} />
              <Text style={styles.sectionTitle}>
                {isCampaignFlow ? 'اكتملت الحملة' : 'اكتمل الإرسال المباشر'}
              </Text>
            </View>
            <Text style={styles.mutedText}>
              الإجمالي {sendResult.total} · نجح {sendResult.sent} · فشل {sendResult.failed}
            </Text>
            {sendResult.recipients
              .filter((recipient) => recipient.status === 'failed')
              .map((recipient, index) => (
                <View key={`${recipient.phone}-${index}`} style={styles.failureItem}>
                  <Text style={styles.optionTitle}>{recipient.name} · {recipient.phone}</Text>
                  <Text style={styles.errorText}>{recipient.error}</Text>
                </View>
              ))}
            <Pressable onPress={resetDirectSend} style={styles.primaryButton}>
              <FileSpreadsheet size={18} color={colors.neutral[0]} />
              <Text style={styles.primaryButtonText}>إرسال مستند آخر</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>

      <Modal
        visible={showImportModal}
        animationType="slide"
        transparent
        onRequestClose={handleCancelImport}
      >
        {showImportModal ? (
          <View style={styles.importModalBackdrop}>
            <DocumentImportModal
              variables={messageMode === 'template' ? placeholders : []}
              showRecipientMapping
              recipientMessageMode={messageMode ?? undefined}
              sharedFile={sharedFile}
              onDirectSend={messageMode === 'prepared' ? handlePreparedDirectSend : undefined}
              canSendDirectly={Boolean(gatewaySettings?.default_connection_id)}
              directSendProgress={progress}
              onOpenSettings={handleOpenGatewaySettings}
              onMapped={handleDocumentMapped}
              onCancel={handleCancelImport}
            />
          </View>
        ) : null}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.neutral[50] },
  content: { paddingHorizontal: spacing.md, gap: spacing.md },
  campaignNameField: {
    gap: 6,
  },
  fieldLabel: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    color: colors.neutral[700],
    textAlign: 'right',
  },
  campaignNameInput: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.neutral[200],
    backgroundColor: colors.neutral[0],
    paddingHorizontal: 12,
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.neutral[900],
    textAlign: 'right',
  },
  importModalBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
    backgroundColor: colors.neutral[900] + '66',
  },
  modeSection: { gap: spacing.sm },
  centered: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.5 },
  header: { flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.sm },
  headerCopy: { flex: 1, gap: 2 },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.neutral[0],
    borderWidth: 1,
    borderColor: colors.neutral[200],
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontFamily: fonts.bold, fontSize: 24, color: colors.neutral[900], textAlign: 'right' },
  subtitle: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, color: colors.neutral[600], textAlign: 'right' },
  mutedText: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, color: colors.neutral[600], textAlign: 'right' },
  optionList: { gap: spacing.xs },
  option: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.neutral[200],
    backgroundColor: colors.neutral[0],
    padding: spacing.sm,
  },
  optionSelected: { borderColor: colors.primary[600], backgroundColor: colors.primary[50] },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: colors.neutral[400] },
  radioSelected: { borderWidth: 5, borderColor: colors.primary[600] },
  optionCopy: { flex: 1, gap: 2 },
  optionTitle: { fontFamily: fonts.semibold, fontSize: 14, color: colors.neutral[900], textAlign: 'right' },
  optionSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.neutral[600], textAlign: 'right' },
  noticeBox: { backgroundColor: colors.warning[500] + '20', borderRadius: 12, padding: spacing.sm, gap: spacing.xs },
  noticeText: { fontFamily: fonts.regular, fontSize: 13, color: colors.neutral[700], textAlign: 'right' },
  settingsLink: { alignSelf: 'flex-end', paddingVertical: spacing.xs },
  settingsLinkText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.primary[700] },
  errorBox: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.error[500] + '55',
    backgroundColor: colors.error[50],
    padding: spacing.sm,
  },
  errorText: { flex: 1, fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, color: colors.error[700], textAlign: 'right' },
  primaryButton: {
    minHeight: 50,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderRadius: 14,
    backgroundColor: colors.primary[700],
    paddingHorizontal: spacing.md,
  },
  primaryButtonText: { fontFamily: fonts.bold, fontSize: 15, color: colors.neutral[0] },
  section: {
    backgroundColor: colors.neutral[0],
    borderWidth: 1,
    borderColor: colors.neutral[200],
    borderRadius: 16,
    padding: spacing.md,
    gap: spacing.sm,
  },
  sectionHeading: { flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.xs },
  sectionTitle: { fontFamily: fonts.bold, fontSize: 16, color: colors.neutral[900], textAlign: 'right' },
  sourceName: { fontFamily: fonts.semibold, fontSize: 13, color: colors.primary[700], textAlign: 'right' },
  previewList: { gap: spacing.xs },
  previewItem: { backgroundColor: colors.neutral[50], borderRadius: 12, padding: spacing.sm, gap: spacing.xs },
  previewTop: { flexDirection: 'row-reverse', justifyContent: 'space-between', gap: spacing.xs },
  phone: { fontFamily: fonts.semibold, fontSize: 12, color: colors.neutral[600], writingDirection: 'ltr' },
  messageText: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, color: colors.neutral[700], textAlign: 'right' },
  secondaryButton: { alignItems: 'center', paddingVertical: spacing.sm },
  secondaryButtonText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.primary[700] },
  failureItem: { backgroundColor: colors.error[50], borderRadius: 10, padding: spacing.sm, gap: 3 },
});

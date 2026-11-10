import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
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
import { fetchGatewaySettings } from '@/lib/gatewaySettings';
import type { GatewaySettings } from '@/lib/gatewaySettings';
import { extractPlaceholders, fetchTemplates, renderMessage } from '@/lib/templates';
import type { MessageTemplate } from '@/lib/templates';
import type { DocumentAnalysis } from '@/lib/documentParser';
import { buildDocumentRecipients } from '@/lib/documentRecipients';
import type { DocumentRecipientMapping } from '@/lib/documentRecipients';
import { sendDirectMessages } from '@/lib/directSend';
import type { DirectSendRecipient, DirectSendResult } from '@/lib/directSend';

type SendStep = 'setup' | 'preview' | 'sending' | 'result';

export default function DirectSendScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  const handledShareIntent = useRef(false);
  const [gatewaySettings, setGatewaySettings] = useState<GatewaySettings | null>(null);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [selectedConnection, setSelectedConnection] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [recipients, setRecipients] = useState<DirectSendRecipient[]>([]);
  const [sourceName, setSourceName] = useState('');
  const [step, setStep] = useState<SendStep>('setup');
  const [showImportModal, setShowImportModal] = useState(false);
  const [sharedFile, setSharedFile] = useState<{ uri: string; name: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sendResult, setSendResult] = useState<DirectSendResult | null>(null);
  const [progress, setProgress] = useState({ sent: 0, failed: 0, processed: 0, total: 0 });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [settings, templateList] = await Promise.all([
        fetchGatewaySettings(),
        fetchTemplates(),
      ]);
      setGatewaySettings(settings);
      setTemplates(templateList);
      setSelectedConnection((current) =>
        settings.connections.some((connection) => connection.id === current)
          ? current
          : settings.connections[0]?.id ?? '',
      );
      setSelectedTemplate((current) => {
        if (templateList.some((template) => template.id === current)) return current;
        return (templateList.find((template) => template.is_default) ?? templateList[0])?.id ?? '';
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'تعذر تحميل بيانات الإرسال المباشر.');
    } finally {
      setLoading(false);
    }
  }, []);

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
    setShowImportModal(true);
    resetShareIntent();
  }, [hasShareIntent, shareIntent.files, resetShareIntent]);

  const selectedTemplateObject = templates.find((template) => template.id === selectedTemplate);
  const placeholders = useMemo(
    () => selectedTemplateObject ? extractPlaceholders(selectedTemplateObject.body) : [],
    [selectedTemplateObject],
  );
  const selectedConnectionObject = gatewaySettings?.connections.find(
    (connection) => connection.id === selectedConnection,
  );

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

  const handleSend = async () => {
    if (!selectedConnection) {
      setError('اختر بوابة الإرسال أولاً.');
      return;
    }
    setSending(true);
    setError(null);
    setProgress({ sent: 0, failed: 0, processed: 0, total: recipients.length });
    setStep('sending');
    try {
      const result = await sendDirectMessages(selectedConnection, recipients, setProgress);
      setSendResult(result);
      setStep('result');
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'تعذر تنفيذ الإرسال المباشر.');
      setStep('preview');
    } finally {
      setSending(false);
    }
  };

  const resetDirectSend = () => {
    setStep('setup');
    setRecipients([]);
    setSourceName('');
    setSendResult(null);
    setProgress({ sent: 0, failed: 0, processed: 0, total: 0 });
    setError(null);
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
            accessibilityLabel="العودة إلى لوحة التحكم"
            onPress={() => router.back()}
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
          >
            <ArrowRight size={20} color={colors.neutral[700]} />
          </Pressable>
          <View style={styles.headerCopy}>
            <Text style={styles.title}>إرسال مباشر</Text>
            <Text style={styles.subtitle}>أرسل من مستند دون إنشاء حملة أو إضافتها إلى سجل الحملات</Text>
          </View>
        </View>

        {error ? (
          <View style={styles.errorBox}>
            <XCircle size={18} color={colors.error[600]} />
            <Text style={styles.errorText}>{error}</Text>
            {!gatewaySettings ? (
              <Pressable onPress={() => void load()} style={styles.settingsLink}>
                <Text style={styles.settingsLinkText}>إعادة المحاولة</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {gatewaySettings?.connections.length ? (
          <Field label="بوابة الإرسال" Icon={Send}>
            <View style={styles.optionList}>
              {gatewaySettings.connections.map((connection) => {
                const selected = selectedConnection === connection.id;
                return (
                  <Pressable
                    key={connection.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected, disabled: sending }}
                    onPress={() => setSelectedConnection(connection.id)}
                    disabled={sending}
                    style={({ pressed }) => [
                      styles.option,
                      selected && styles.optionSelected,
                      pressed && styles.pressed,
                      sending && styles.disabled,
                    ]}
                  >
                    <View style={[styles.radio, selected && styles.radioSelected]} />
                    <View style={styles.optionCopy}>
                      <Text style={styles.optionTitle}>{connection.sender_name}</Text>
                      <Text style={styles.optionSub} numberOfLines={1}>{connection.endpoint_url}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </Field>
        ) : (
          <View style={styles.noticeBox}>
            <Text style={styles.errorText}>لا توجد بوابة إرسال. أضف بوابة من الإعدادات للبدء.</Text>
            <Pressable onPress={() => router.push('/(tabs)/settings')} style={styles.settingsLink}>
              <Text style={styles.settingsLinkText}>فتح الإعدادات</Text>
            </Pressable>
          </View>
        )}

        {templates.length ? (
          <Field label="القالب الافتراضي للرسائل غير الجاهزة" Icon={Layers}>
            <View style={styles.optionList}>
              {templates.map((template) => {
                const selected = selectedTemplate === template.id;
                return (
                  <Pressable
                    key={template.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected, disabled: step !== 'setup' }}
                    onPress={() => setSelectedTemplate(template.id)}
                    disabled={step !== 'setup'}
                    style={({ pressed }) => [
                      styles.option,
                      selected && styles.optionSelected,
                      pressed && styles.pressed,
                      step !== 'setup' && styles.disabled,
                    ]}
                  >
                    <View style={[styles.radio, selected && styles.radioSelected]} />
                    <View style={styles.optionCopy}>
                      <Text style={styles.optionTitle}>{template.title}</Text>
                      <Text style={styles.optionSub} numberOfLines={2}>{template.body}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </Field>
        ) : (
          <View style={styles.noticeBox}>
            <Text style={styles.noticeText}>
              يمكن إرسال المستندات ذات الرسائل الجاهزة دون قالب. أنشئ قالباً لاستخدام المستندات الأخرى.
            </Text>
          </View>
        )}

        {step === 'setup' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="اختيار مستند للإرسال المباشر"
            onPress={() => {
              setError(null);
              setShowImportModal(true);
            }}
            disabled={!selectedConnection}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.pressed,
              !selectedConnection && styles.disabled,
            ]}
          >
            <FileSpreadsheet size={19} color={colors.neutral[0]} />
            <Text style={styles.primaryButtonText}>اختيار مستند للإرسال</Text>
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
              {recipients.length} رسالة عبر {selectedConnectionObject?.sender_name ?? 'البوابة المحددة'}
            </Text>
            <View style={styles.previewList}>
              {recipients.slice(0, 4).map((recipient, index) => (
                <View key={`${recipient.phone}-${index}`} style={styles.previewItem}>
                  <View style={styles.previewTop}>
                    <Text style={styles.optionTitle}>{recipient.name}</Text>
                    <Text style={styles.phone}>{recipient.phone}</Text>
                  </View>
                  <Text style={styles.messageText}>{recipient.message}</Text>
                </View>
              ))}
              {recipients.length > 4 ? (
                <Text style={styles.mutedText}>و{recipients.length - 4} رسائل أخرى</Text>
              ) : null}
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={handleSend}
              disabled={sending || !selectedConnection}
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && styles.pressed,
                (sending || !selectedConnection) && styles.disabled,
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
            <Text style={styles.sectionTitle}>جاري الإرسال المباشر</Text>
            <Text style={styles.mutedText}>
              تمت معالجة {progress.processed} من {progress.total}، نجح {progress.sent} وتعذر {progress.failed}
            </Text>
          </View>
        ) : null}

        {step === 'result' && sendResult ? (
          <View style={styles.section}>
            <View style={styles.sectionHeading}>
              <CheckCircle2 size={20} color={sendResult.failed ? colors.warning[600] : colors.success[600]} />
              <Text style={styles.sectionTitle}>اكتمل الإرسال المباشر</Text>
            </View>
            <Text style={styles.mutedText}>
              الإجمالي {sendResult.total} · نجح {sendResult.sent} · فشل {sendResult.failed}
            </Text>
            {sendResult.recipients
              .filter((recipient) => recipient.status === 'failed')
              .slice(0, 5)
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
        onRequestClose={() => {
          setShowImportModal(false);
          setSharedFile(null);
        }}
      >
        {showImportModal ? (
          <DocumentImportModal
            variables={placeholders}
            showRecipientMapping
            sharedFile={sharedFile}
            onMapped={handleDocumentMapped}
            onCancel={() => {
              setShowImportModal(false);
              setSharedFile(null);
            }}
          />
        ) : null}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.neutral[50] },
  content: { paddingHorizontal: spacing.md, gap: spacing.md },
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

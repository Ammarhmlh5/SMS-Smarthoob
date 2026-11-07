import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Mail, Lock, Eye, EyeOff } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { colors, fonts, spacing } from '@/constants/theme';

type Mode = 'signin' | 'signup';

function validate(email: string, password: string): string | null {
  if (!email.includes('@')) return 'أدخل بريداً إلكترونياً صحيحاً';
  if (password.length < 6) return 'كلمة المرور يجب أن تكون 6 أحرف على الأقل';
  return null;
}

export default function LoginScreen() {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const switchMode = (newMode: Mode) => {
    setMode(newMode);
    setError(null);
  };

  const handleSubmit = async () => {
    const validationError = validate(email, password);
    if (validationError) {
      setError(validationError);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const { error: authError } =
        mode === 'signin'
          ? await supabase.auth.signInWithPassword({ email: email.trim(), password })
          : await supabase.auth.signUp({ email: email.trim(), password });

      if (authError) {
        setError(
          authError.message.includes('Invalid login')
            ? 'البريد أو كلمة المرور غير صحيحة'
            : authError.message.includes('already')
              ? 'هذا البريد مسجل بالفعل، سجّل الدخول'
              : 'تعذر إتمام العملية. تأكد من البيانات وحاول مرة أخرى.',
        );
      }
    } catch {
      setError('تعذر الاتصال بالخادم. تحقق من اتصالك بالإنترنت.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'web' ? undefined : 'padding'}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.brandBlock}>
            <Text style={styles.brand}>هدهد الفواتير</Text>
            <Text style={styles.welcome}>
              {mode === 'signin' ? 'أهلاً بعودتك' : 'أنشئ حسابك'}
            </Text>
            <Text style={styles.subtitle}>
              {mode === 'signin'
                ? 'سجّل الدخول للوصول إلى لوحة التحكم'
                : 'سجّل بحساب جديد للبدء في إرسال الفواتير'}
            </Text>
          </View>

          <View style={styles.card}>
            <View style={styles.field}>
              <View style={styles.labelRow}>
                <Mail size={16} color={colors.neutral[500]} strokeWidth={2} />
                <Text style={styles.label}>البريد الإلكتروني</Text>
              </View>
              <TextInput
                value={email}
                onChangeText={(v) => {
                  setEmail(v);
                  setError(null);
                }}
                placeholder="name@example.com"
                placeholderTextColor={colors.neutral[400]}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                editable={!busy}
                style={[styles.input, styles.ltrText]}
              />
            </View>

            <View style={styles.field}>
              <View style={styles.labelRow}>
                <Lock size={16} color={colors.neutral[500]} strokeWidth={2} />
                <Text style={styles.label}>كلمة المرور</Text>
              </View>
              <View style={styles.passwordRow}>
                <TextInput
                  value={password}
                  onChangeText={(v) => {
                    setPassword(v);
                    setError(null);
                  }}
                  placeholder="••••••••"
                  placeholderTextColor={colors.neutral[400]}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!busy}
                  style={[styles.input, styles.ltrText, styles.passwordInput]}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                  onPress={() => setShowPassword((v) => !v)}
                  disabled={busy}
                  style={styles.eyeButton}
                >
                  {showPassword ? (
                    <EyeOff size={18} color={colors.neutral[500]} strokeWidth={2} />
                  ) : (
                    <Eye size={18} color={colors.neutral[500]} strokeWidth={2} />
                  )}
                </Pressable>
              </View>
            </View>

            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={mode === 'signin' ? 'تسجيل الدخول' : 'إنشاء حساب'}
              onPress={handleSubmit}
              disabled={busy}
              style={({ pressed }) => [styles.submitButton, pressed && styles.pressed, busy && styles.disabled]}
            >
              {busy ? (
                <ActivityIndicator color={colors.neutral[0]} />
              ) : (
                <Text style={styles.submitText}>
                  {mode === 'signin' ? 'تسجيل الدخول' : 'إنشاء حساب'}
                </Text>
              )}
            </Pressable>

            <View style={styles.switchRow}>
              <Text style={styles.switchText}>
                {mode === 'signin' ? 'ليس لديك حساب؟ ' : 'لديك حساب بالفعل؟ '}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => switchMode(mode === 'signin' ? 'signup' : 'signin')}
                disabled={busy}
              >
                <Text style={styles.switchLink}>
                  {mode === 'signin' ? 'إنشاء حساب' : 'تسجيل الدخول'}
                </Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.neutral[50],
  },
  flex: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.lg,
    justifyContent: 'center',
    gap: spacing.lg,
  },
  brandBlock: {
    alignItems: 'center',
    gap: spacing.xs / 2,
  },
  brand: {
    fontFamily: fonts.bold,
    fontSize: 24,
    lineHeight: 32,
    color: colors.primary[700],
    writingDirection: 'rtl',
  },
  welcome: {
    fontFamily: fonts.bold,
    fontSize: 28,
    lineHeight: 36,
    color: colors.neutral[900],
    writingDirection: 'rtl',
  },
  subtitle: {
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 24,
    color: colors.neutral[500],
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  card: {
    backgroundColor: colors.neutral[0],
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.neutral[200],
    padding: spacing.md,
    gap: spacing.sm,
  },
  field: {
    gap: spacing.xs / 2,
  },
  labelRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.xs / 2,
  },
  label: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    lineHeight: 21,
    color: colors.neutral[700],
    writingDirection: 'rtl',
  },
  input: {
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 22,
    color: colors.neutral[900],
    backgroundColor: colors.neutral[50],
    borderWidth: 1,
    borderColor: colors.neutral[200],
    borderRadius: 14,
    paddingHorizontal: spacing.sm,
    paddingVertical: 12,
    textAlign: 'right',
  },
  ltrText: {
    textAlign: 'left',
    writingDirection: 'ltr',
  },
  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  passwordInput: {
    flex: 1,
  },
  eyeButton: {
    position: 'absolute',
    right: spacing.xs,
    padding: spacing.xs / 2,
  },
  errorText: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    lineHeight: 21,
    color: colors.error[600],
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  submitButton: {
    height: 52,
    borderRadius: 14,
    backgroundColor: colors.primary[700],
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xs / 2,
  },
  submitText: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: colors.neutral[0],
    writingDirection: 'rtl',
  },
  switchRow: {
    flexDirection: 'row-reverse',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.xs / 4,
    marginTop: spacing.xs / 2,
  },
  switchText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 21,
    color: colors.neutral[500],
    writingDirection: 'rtl',
  },
  switchLink: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    lineHeight: 21,
    color: colors.primary[700],
    writingDirection: 'rtl',
  },
  pressed: {
    opacity: 0.85,
  },
  disabled: {
    opacity: 0.6,
  },
});

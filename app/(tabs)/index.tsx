import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ClipboardList, Layers } from 'lucide-react-native';
import { MenuCard } from '@/components/MenuCard';
import { colors, fonts, spacing } from '@/constants/theme';

export default function MainMenuScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.md, paddingBottom: spacing.lg },
      ]}
    >
      <View style={styles.header}>
        <Text style={styles.brand}>هدهد الفواتير</Text>
        <Text style={styles.heading}>القائمة الرئيسية</Text>
        <Text style={styles.subheading}>أرسل رسائل الفواتير لمشتركيك بخطوات بسيطة</Text>
      </View>

      <View style={styles.cards}>
        <MenuCard
          title="الرسائل الجاهزة"
          description="إدارة الرسائل المحفوظة مسبقاً ومراجعتها وإرسالها"
          Icon={ClipboardList}
          onPress={() => router.navigate('/templates')}
        />
        <MenuCard
          title="تجهيز الحملات"
          description="استيراد الفواتير وربط المتغيرات واختيار القالب ثم الإرسال الجماعي"
          Icon={Layers}
          onPress={() => router.navigate('/campaigns')}
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
  brand: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    lineHeight: 21,
    color: colors.primary[700],
    textAlign: 'right',
    writingDirection: 'rtl',
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
  cards: {
    gap: spacing.sm,
  },
});

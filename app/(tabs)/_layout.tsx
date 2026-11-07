import { Tabs } from 'expo-router';
import { BottomNav } from '@/components/BottomNav';
import { colors } from '@/constants/theme';

export default function TabLayout() {
  return (
    <Tabs
      tabBar={(props) => <BottomNav {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.neutral[50] },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'القائمة الرئيسية' }} />
      <Tabs.Screen name="campaigns" options={{ title: 'الحملات' }} />
      <Tabs.Screen name="templates" options={{ title: 'القوالب' }} />
      <Tabs.Screen name="settings" options={{ title: 'الإعدادات' }} />
    </Tabs>
  );
}

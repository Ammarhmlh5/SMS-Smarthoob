import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Home, Megaphone, FileText, Settings, Send } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { colors, fonts } from '@/constants/theme';

type BottomTabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

type TabItem = {
  routeName: string;
  label: string;
  Icon: LucideIcon;
};

const MAIN_TAB: TabItem = { routeName: 'index', label: 'القائمة الرئيسية', Icon: Home };
const CAMPAIGNS_TAB: TabItem = { routeName: 'campaigns', label: 'الحملات', Icon: Megaphone };
const TEMPLATES_TAB: TabItem = { routeName: 'templates', label: 'القوالب', Icon: FileText };
const SETTINGS_TAB: TabItem = { routeName: 'settings', label: 'الإعدادات', Icon: Settings };

export function BottomNav({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const activeRouteName = state.routes[state.index]?.name;

  const navigateTo = (routeName: string) => {
    const route = state.routes.find((r) => r.name === routeName);
    if (!route) return;
    const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
    if (activeRouteName !== routeName && !event.defaultPrevented) {
      navigation.navigate(route.name, route.params);
    }
  };

  const renderTab = ({ routeName, label, Icon }: TabItem) => {
    const focused = activeRouteName === routeName;
    const color = focused ? colors.primary[700] : colors.neutral[500];

    return (
      <Pressable
        key={routeName}
        accessibilityRole="tab"
        accessibilityState={{ selected: focused }}
        accessibilityLabel={label}
        onPress={() => navigateTo(routeName)}
        style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
      >
        <View style={[styles.iconWrap, focused && styles.iconWrapActive]}>
          <Icon size={22} color={color} strokeWidth={2} />
        </View>
        <Text style={[styles.label, { color }]} numberOfLines={1}>
          {label}
        </Text>
      </Pressable>
    );
  };

  return (
    <View style={[styles.wrapper, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      <View style={styles.bar}>
        {renderTab(MAIN_TAB)}
        {renderTab(CAMPAIGNS_TAB)}
        <View style={styles.fabSlot}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="زر الإرسال الرئيسي"
            onPress={() => navigateTo(CAMPAIGNS_TAB.routeName)}
            style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
          >
            <Send size={26} color={colors.neutral[0]} strokeWidth={2} />
          </Pressable>
        </View>
        {renderTab(TEMPLATES_TAB)}
        {renderTab(SETTINGS_TAB)}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: colors.neutral[0],
    borderTopWidth: 1,
    borderTopColor: colors.neutral[200],
    paddingTop: 8,
  },
  bar: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
  },
  pressed: {
    opacity: 0.7,
  },
  iconWrap: {
    width: 48,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapActive: {
    backgroundColor: colors.primary[50],
  },
  label: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    lineHeight: 16,
  },
  fabSlot: {
    flex: 1,
    alignItems: 'center',
  },
  fab: {
    width: 60,
    height: 60,
    borderRadius: 30,
    marginTop: -28,
    backgroundColor: colors.primary[700],
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: colors.neutral[0],
    shadowColor: colors.primary[800],
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 8,
  },
  fabPressed: {
    transform: [{ scale: 0.94 }],
  },
});

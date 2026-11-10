import { useEffect, useRef } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import {
  Cairo_400Regular,
  Cairo_600SemiBold,
  Cairo_700Bold,
} from '@expo-google-fonts/cairo';
import { useFrameworkReady } from '@/hooks/useFrameworkReady';
import { AuthProvider, useAuth } from '@/lib/auth';
import { colors, fonts } from '@/constants/theme';
import { ShareIntentProvider, useShareIntentContext } from 'expo-share-intent';

SplashScreen.preventAutoHideAsync();

function RootNavigator() {
  const { session, loading } = useAuth();
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  const handledShareIntent = useRef(false);
  const segments = useSegments();
  const router = useRouter();

  const inAuthGroup = segments[0] === 'login';

  useEffect(() => {
    if (loading) return;
    if (!session && !inAuthGroup) {
      router.replace('/login');
    } else if (session && inAuthGroup) {
      router.replace('/');
    }
  }, [session, loading, inAuthGroup, router]);

  useEffect(() => {
    if (!hasShareIntent) {
      handledShareIntent.current = false;
      return;
    }
    if (!shareIntent.files?.length) {
      resetShareIntent();
      return;
    }
    if (session && !handledShareIntent.current) {
      handledShareIntent.current = true;
      router.replace('/direct-send');
    }
  }, [hasShareIntent, shareIntent.files, resetShareIntent, session, router]);

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.primary[700]} />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.neutral[50] } }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="direct-send" />
      <Stack.Screen name="login" />
      <Stack.Screen name="+not-found" />
    </Stack>
  );
}

export default function RootLayout() {
  useFrameworkReady();

  const [fontsLoaded, fontError] = useFonts({
    [fonts.regular]: Cairo_400Regular,
    [fonts.semibold]: Cairo_600SemiBold,
    [fonts.bold]: Cairo_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <ShareIntentProvider options={{ resetOnBackground: false }}>
      <AuthProvider>
        <RootNavigator />
        <StatusBar style="dark" />
      </AuthProvider>
    </ShareIntentProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.neutral[50],
  },
});

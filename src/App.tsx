/**
 * Tatkal Copilot — root component + minimal stack router.
 *
 * Deliberately hand-rolled: neither expo-router nor react-navigation is
 * installed, and both would need network installs + (for react-navigation)
 * new native modules. A state-based router needs zero new deps and is
 * fully testable here. Swap for a real navigator later if the screen
 * count grows — the Route/Nav contract makes that mechanical.
 *
 * Wave 2a: the root is wrapped in ThemeProvider (StatusBar follows the
 * theme), a first-launch onboarding gate (src/onboarding.ts), and a bottom
 * tab bar (Home / Book / PNR / Activity / Profile) that renders ONLY on the
 * five tab roots. Tapping a tab RESETS the stack to that root; hardware back
 * from a tab root exits (unchanged behavior). ErrorBoundary + the screen-
 * reader route announcer are kept.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  BackHandler,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ThemeProvider, useTheme, loadSavedTheme } from './theme';
import { ErrorBoundary } from './ErrorBoundary';
import { pushRoute } from './nav';
import { BottomTabs, type TabName } from './components/BottomTabs';
import { SnackbarProvider } from './components/ui';
import UpdateBanner from './components/UpdateBanner';
import { checkForAppUpdate } from './updates';
import { syncLatestAutomationData } from './native/tatkalProbe';
import { isOnboardingDone } from './onboarding';
import HomeScreen from './screens/HomeScreen';
import PassengersScreen from './screens/PassengersScreen';
import PnrScreen from './screens/PnrScreen';
import TripSetupScreen from './screens/TripSetupScreen';
import CountdownScreen from './screens/CountdownScreen';
import BookingScreen from './screens/BookingScreen';
import IrctcBrowserScreen from './screens/TrainLookupScreen';
import IrctcAccountScreen from './screens/IrctcAccountScreen';
// Wave 2a screens
import OnboardingScreen from './screens/OnboardingScreen';
import BookScreen from './screens/BookScreen';
import ActivityScreen from './screens/ActivityScreen';
import NotificationsScreen from './screens/NotificationsScreen';
import ProfileScreen from './screens/ProfileScreen';
import SettingsScreen from './screens/SettingsScreen';
import SecurityScreen from './screens/SecurityScreen';
import HelpScreen from './screens/HelpScreen';
import ProbeScreen from './screens/ProbeScreen';
import SetupAutomationScreen from './screens/SetupAutomationScreen';

export type Route =
  | { name: 'home' }
  | { name: 'book' }
  | { name: 'pnr' }
  | { name: 'activity' }
  | { name: 'profile' }
  | { name: 'passengers' }
  | { name: 'tripSetup'; tripId?: string }
  | { name: 'countdown'; tripId: string }
  | { name: 'booking'; tripId: string }
  | { name: 'trainLookup' }
  | { name: 'irctcLogin' }
  | { name: 'irctcAccount' }
  | { name: 'onboarding' }
  | { name: 'notifications' }
  | { name: 'settings' }
  | { name: 'security' }
  | { name: 'help' }
  | { name: 'probe' }
  | { name: 'setupAutomation' };

export interface Nav {
  go: (r: Route) => void;
  back: () => void;
  /**
   * Replace the whole stack with a single route. Used for tab switches
   * (tap = go to the tab's root, never stack-push) and for leaving
   * onboarding, where "back" must not return to the intro.
   */
  reset: (r: Route) => void;
}

const ROUTE_TITLES: Record<Route['name'], string> = {
  home: 'Home',
  book: 'Book',
  pnr: 'PNR Status',
  activity: 'Activity',
  profile: 'Profile',
  passengers: 'Passengers',
  tripSetup: 'Trip setup',
  countdown: 'Countdown',
  booking: 'Booking',
  trainLookup: 'Train lookup',
  irctcLogin: 'IRCTC login',
  irctcAccount: 'IRCTC account',
  onboarding: 'Welcome',
  notifications: 'Notifications',
  settings: 'Settings',
  security: 'Security and privacy',
  help: 'Help',
  probe: 'Automation probe',
  setupAutomation: 'Booking automation',
};

/** Routes that show the bottom tab bar. Everything else hides it. */
const TAB_ROOTS: TabName[] = ['home', 'book', 'pnr', 'activity', 'profile'];

function isTabRoot(name: Route['name']): name is TabName {
  return (TAB_ROOTS as string[]).includes(name);
}

function AppShell() {
  const { theme, isDark } = useTheme();
  const [stack, setStack] = useState<Route[]>([{ name: 'home' }]);
  const [booted, setBooted] = useState(false);
  const route = stack[stack.length - 1];

  const go = useCallback((r: Route) => setStack((s) => pushRoute(s, r)), []);
  const back = useCallback(
    () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)),
    [],
  );
  const reset = useCallback((r: Route) => setStack([r]), []);
  const nav: Nav = { go, back, reset };

  // First-launch gate: until the onboarding completion flag is set, the app
  // opens on the onboarding flow instead of home. The flag is written only
  // when the user finishes, so backing out re-shows it next launch.
  useEffect(() => {
    let live = true;
    void (async () => {
      const done = await isOnboardingDone();
      if (live) {
        if (!done) setStack([{ name: 'onboarding' }]);
        setBooted(true);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  // Keep the tap service's choreography map + trip data fresh, so a
  // booking started from the Quick Settings tile uses the latest steps
  // (language, login, search) without opening the Booking screen first.
  useEffect(() => {
    void syncLatestAutomationData();
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active' || st === 'background') void syncLatestAutomationData();
    });
    return () => sub.remove();
  }, []);

  // Hardware back button: pop the app's screen stack. Screens with a WebView
  // (Booking, browser) register their own handler first — it steps back
  // inside the page when possible and returns false otherwise, letting this
  // one pop the screen. At a root (home, any tab root, onboarding) we return
  // false so the system exits.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      let consumed = false;
      setStack((s) => {
        if (s.length > 1) {
          consumed = true;
          return s.slice(0, -1);
        }
        return s;
      });
      return consumed;
    });
    return () => sub.remove();
  }, []);

  // App updates: check once per launch, visibly. The banner (UpdateBanner)
  // surfaces checking / downloading / ready / restarting; up-to-date and
  // errors stay quiet here and are visible on the Settings → App updates
  // row instead. Nothing updates silently.
  useEffect(() => {
    if (!booted) return;
    void checkForAppUpdate();
  }, [booted]);

  const statusBarStyle = isDark ? 'light-content' : 'dark-content';

  if (!booted) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: theme.colors.bg }]}>
        <StatusBar barStyle={statusBarStyle} backgroundColor={theme.colors.bg} />
        <View style={styles.bootWrap}>
          <ActivityIndicator
            size="large"
            color={theme.colors.primary}
            accessibilityLabel="Starting Tatkal Copilot"
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.colors.bg }]}>
      <StatusBar barStyle={statusBarStyle} backgroundColor={theme.colors.bg} />
      {/* Invisible live region: announces the screen title to screen readers
          on every route change. */}
      <Text style={styles.routeAnnouncer} accessibilityLiveRegion="polite">
        {ROUTE_TITLES[route.name]}
      </Text>
      <UpdateBanner />
      <View style={styles.screenWrap}>
        <ErrorBoundary onReset={() => setStack([{ name: 'home' }])} key={stack.length}>
          {route.name === 'home' && <HomeScreen nav={nav} />}
          {route.name === 'book' && <BookScreen nav={nav} />}
          {route.name === 'pnr' && <PnrScreen nav={nav} />}
          {route.name === 'activity' && <ActivityScreen nav={nav} />}
          {route.name === 'profile' && <ProfileScreen nav={nav} />}
          {route.name === 'passengers' && <PassengersScreen nav={nav} />}
          {route.name === 'tripSetup' && (
            <TripSetupScreen nav={nav} tripId={route.tripId} />
          )}
          {route.name === 'countdown' && (
            <CountdownScreen nav={nav} tripId={route.tripId} />
          )}
          {route.name === 'booking' && <BookingScreen nav={nav} tripId={route.tripId} />}
          {route.name === 'trainLookup' && (
            <IrctcBrowserScreen
              nav={nav}
              title="Find your train"
              hint="Search trains on IRCTC below, note the 5-digit train number, then go back and enter it. (The official RailOne app works too — same IRCTC backend, same Tatkal quota.)"
              backLabel="Back to trip setup"
            />
          )}
          {route.name === 'irctcAccount' && (
            <IrctcAccountScreen nav={nav} />
          )}
          {route.name === 'irctcLogin' && (
            <IrctcBrowserScreen
              nav={nav}
              title="Log in to IRCTC"
              hint="Log in with your IRCTC user ID and password here, BEFORE the Tatkal window opens. Heads-up: IRCTC may still ask you to log in again at booking time — that's their rule, not the app's. Type your credentials only on IRCTC's own page."
              backLabel="Back to home"
            />
          )}
          {route.name === 'onboarding' && <OnboardingScreen nav={nav} />}
          {route.name === 'notifications' && <NotificationsScreen nav={nav} />}
          {route.name === 'settings' && <SettingsScreen nav={nav} />}
          {route.name === 'security' && <SecurityScreen nav={nav} />}
          {route.name === 'help' && <HelpScreen nav={nav} />}
          {route.name === 'probe' && <ProbeScreen nav={nav} />}
          {route.name === 'setupAutomation' && <SetupAutomationScreen nav={nav} />}
        </ErrorBoundary>
      </View>
      {isTabRoot(route.name) && (
        <BottomTabs active={route.name} onSelect={(t) => setStack([{ name: t }])} />
      )}
    </SafeAreaView>
  );
}

export default function App() {
  // Restore the user's saved theme choice (light/dark) before first paint
  // where possible — otherwise an OTA restart resets to the system scheme.
  useEffect(() => {
    void loadSavedTheme();
  }, []);
  return (
    <ThemeProvider>
      <SnackbarProvider>
        <AppShell />
      </SnackbarProvider>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  bootWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  screenWrap: { flex: 1 },
  // 1x1, fully transparent: present for assistive tech, invisible otherwise.
  routeAnnouncer: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
  },
});

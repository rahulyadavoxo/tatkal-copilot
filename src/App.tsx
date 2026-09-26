/**
 * Tatkal Copilot — root component + minimal stack router.
 *
 * Deliberately hand-rolled: neither expo-router nor react-navigation is
 * installed, and both would need network installs + (for react-navigation)
 * new native modules. A state-based router needs zero new deps and is
 * fully testable here. Swap for a real navigator later if the screen
 * count grows — the Route/Nav contract makes that mechanical.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { BackHandler, SafeAreaView, StatusBar, StyleSheet } from 'react-native';
import { C } from './theme';
import { ErrorBoundary } from './ErrorBoundary';
import { pushRoute } from './nav';
import HomeScreen from './screens/HomeScreen';
import PassengersScreen from './screens/PassengersScreen';
import PnrScreen from './screens/PnrScreen';
import TripSetupScreen from './screens/TripSetupScreen';
import CountdownScreen from './screens/CountdownScreen';
import BookingScreen from './screens/BookingScreen';
import IrctcBrowserScreen from './screens/TrainLookupScreen';

export type Route =
  | { name: 'home' }
  | { name: 'passengers' }
  | { name: 'pnr' }
  | { name: 'tripSetup'; tripId?: string }
  | { name: 'countdown'; tripId: string }
  | { name: 'booking'; tripId: string }
  | { name: 'trainLookup' }
  | { name: 'irctcLogin' };

export interface Nav {
  go: (r: Route) => void;
  back: () => void;
}

export default function App() {
  const [stack, setStack] = useState<Route[]>([{ name: 'home' }]);
  const route = stack[stack.length - 1];

  const go = useCallback(
    (r: Route) => setStack((s) => pushRoute(s, r)),
    [],
  );
  const back = useCallback(
    () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)),
    [],
  );
  const nav: Nav = { go, back };
  const resetToHome = useCallback(() => setStack([{ name: 'home' }]), []);

  // Hardware back button: pop the app's screen stack. Screens with a WebView
  // (Booking, browser) register their own handler first — it steps back
  // inside the page when possible and returns false otherwise, letting this
  // one pop the screen. At home we return false so the system exits.
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

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <ErrorBoundary onReset={resetToHome} key={stack.length}>
        {route.name === 'home' && <HomeScreen nav={nav} />}
        {route.name === 'passengers' && <PassengersScreen nav={nav} />}
        {route.name === 'pnr' && <PnrScreen nav={nav} />}
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
            backLabel="← Back to trip setup"
          />
        )}
        {route.name === 'irctcLogin' && (
          <IrctcBrowserScreen
            nav={nav}
            title="Log in to IRCTC"
            hint="Log in with your IRCTC user ID and password here, BEFORE the Tatkal window opens. Heads-up: IRCTC may still ask you to log in again at booking time — that's their rule, not the app's. Type your credentials only on IRCTC's own page."
            backLabel="← Back to home"
          />
        )}
      </ErrorBoundary>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
});

/**
 * Tatkal Copilot — root component + minimal stack router.
 *
 * Deliberately hand-rolled: neither expo-router nor react-navigation is
 * installed, and both would need network installs + (for react-navigation)
 * new native modules. A state-based router needs zero new deps and is
 * fully testable here. Swap for a real navigator later if the screen
 * count grows — the Route/Nav contract makes that mechanical.
 */
import React, { useCallback, useState } from 'react';
import { SafeAreaView, StatusBar, StyleSheet } from 'react-native';
import { C } from './theme';
import { ErrorBoundary } from './ErrorBoundary';
import HomeScreen from './screens/HomeScreen';
import PassengersScreen from './screens/PassengersScreen';
import PnrScreen from './screens/PnrScreen';
import TripSetupScreen from './screens/TripSetupScreen';
import CountdownScreen from './screens/CountdownScreen';
import BookingScreen from './screens/BookingScreen';

export type Route =
  | { name: 'home' }
  | { name: 'passengers' }
  | { name: 'pnr' }
  | { name: 'tripSetup' }
  | { name: 'countdown'; tripId: string }
  | { name: 'booking'; tripId: string };

export interface Nav {
  go: (r: Route) => void;
  back: () => void;
}

export default function App() {
  const [stack, setStack] = useState<Route[]>([{ name: 'home' }]);
  const route = stack[stack.length - 1];

  const go = useCallback((r: Route) => setStack((s) => [...s, r]), []);
  const back = useCallback(
    () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)),
    [],
  );
  const nav: Nav = { go, back };
  const resetToHome = useCallback(() => setStack([{ name: 'home' }]), []);

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <ErrorBoundary onReset={resetToHome} key={stack.length}>
        {route.name === 'home' && <HomeScreen nav={nav} />}
        {route.name === 'passengers' && <PassengersScreen nav={nav} />}
        {route.name === 'pnr' && <PnrScreen nav={nav} />}
        {route.name === 'tripSetup' && <TripSetupScreen nav={nav} />}
        {route.name === 'countdown' && (
          <CountdownScreen nav={nav} tripId={route.tripId} />
        )}
        {route.name === 'booking' && <BookingScreen nav={nav} tripId={route.tripId} />}
      </ErrorBoundary>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
});

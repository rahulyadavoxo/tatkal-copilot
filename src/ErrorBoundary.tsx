/**
 * ErrorBoundary — the "no white screen of death" net.
 *
 * If any screen throws during render (bad data, unexpected null, a future
 * IRCTC DOM surprise), React would otherwise unmount the whole tree and the
 * user gets a dead app on Tatkal morning. This catches the throw, shows a
 * calm recovery screen with a "back to home" button, and keeps the app alive.
 * It never auto-retries anything and never touches the booking flow.
 */
import React from 'react';
import { Button, StyleSheet, Text, View } from 'react-native';
import { C } from './theme';

interface Props {
  children: React.ReactNode;
  onReset: () => void;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    // Fail visible, not silent: log for diagnostics, show the user a way out.
    // eslint-disable-next-line no-console
    console.error('[TatkalCopilot] screen crashed:', error);
  }

  private handleReset = () => {
    this.setState({ error: null });
    this.props.onReset();
  };

  render() {
    if (this.state.error) {
      return (
        <View style={styles.root}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.body}>
            This screen hit an unexpected error and was stopped before it could
            affect anything else. Your saved passengers and trips are safe.
          </Text>
          <Text style={styles.detail} numberOfLines={3}>
            {this.state.error.message}
          </Text>
          <Button title="Back to home" onPress={this.handleReset} />
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: { color: C.ink, fontSize: 20, fontWeight: '700', marginBottom: 12 },
  body: { color: C.muted, fontSize: 14, textAlign: 'center', marginBottom: 12 },
  detail: { color: C.muted, fontSize: 11, textAlign: 'center', marginBottom: 20 },
});

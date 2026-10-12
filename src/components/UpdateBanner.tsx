/**
 * UpdateBanner — the visible face of app updates.
 *
 * Rendered once at the app root (App.tsx), above every screen. It appears
 * only while an update is actively being checked, downloaded, or applied —
 * never for idle/up-to-date/error, so it can't nag. Screen-reader users get
 * the state announced via the live region.
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme';
import {
  getUpdateStatus,
  subscribeUpdateStatus,
  type UpdateStatus,
} from '../updates';
import { Icon,
  ICON_SIZE,
} from './ui';

const VISIBLE = ['checking', 'downloading', 'ready', 'restarting'] as const;
type VisibleStatus = (typeof VISIBLE)[number];

function isVisibleStatus(s: UpdateStatus): s is VisibleStatus {
  return (VISIBLE as readonly string[]).includes(s);
}

const COPY: Record<VisibleStatus, string> = {
  checking: 'Checking for updates…',
  downloading: 'Downloading update…',
  ready: 'Update downloaded',
  restarting: 'Update ready — restarting…',
};

export default function UpdateBanner(): React.JSX.Element | null {
  const { theme } = useTheme();
  const t = theme.typography;
  const [status, setStatus] = useState<UpdateStatus>(getUpdateStatus());

  useEffect(() => subscribeUpdateStatus(setStatus), []);

  if (!isVisibleStatus(status)) return null;
  const busy = status === 'checking' || status === 'downloading';

  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: theme.colors.successTint,
          borderBottomColor: theme.colors.success,
        },
      ]}
      accessibilityLiveRegion="polite"
      accessibilityLabel={COPY[status]}
    >
      {busy ? (
        <ActivityIndicator
          size="small"
          color={theme.colors.success}
          accessibilityLabel={COPY[status]}
        />
      ) : (
        <Icon name="check" size={ICON_SIZE.xs} color={theme.colors.success} />
      )}
      <Text
        style={[
          styles.text,
          { fontSize: t.bodySm.size, lineHeight: t.bodySm.lineHeight, color: theme.colors.ink },
        ]}
      >
        {COPY[status]}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  text: {
    marginLeft: 8,
    fontWeight: '600',
  },
});

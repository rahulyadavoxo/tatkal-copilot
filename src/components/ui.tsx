/**
 * Tatkal Copilot — reusable component library (Wave 1).
 *
 * All components are theme-aware via `useTheme()` from '../theme'.
 * Documented for Wave 2 workers in ./README.md.
 *
 *   import { Screen, PrimaryButton, Card, useTheme } from './components/ui';
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type {
  StyleProp,
  TextInputProps,
  TextStyle,
  ViewStyle,
} from 'react-native';
import { useTheme } from '../theme';
import type { Theme, ThemeMode } from '../theme';
import { Icon, ICON_SIZE } from './icons';
import type { IconName } from './icons';

/* ------------------------------------------------------------------ */
/* Screen — safe-area-aware container                                  */
/* ------------------------------------------------------------------ */

export interface ScreenProps {
  children: ReactNode;
  /** Wrap in a ScrollView (default true). */
  scroll?: boolean;
  /** Apply standard horizontal/vertical padding (default true). */
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Screen({ children, scroll = true, padded = true, style, contentStyle, testID }: ScreenProps) {
  const { theme } = useTheme();
  const pad = padded ? theme.spacing.lg : 0;
  if (scroll) {
    return (
      <SafeAreaView style={[{ flex: 1, backgroundColor: theme.colors.bg }, style]} testID={testID}>
        <ScrollView
          contentContainerStyle={[{ padding: pad, flexGrow: 1 }, contentStyle]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      </SafeAreaView>
    );
  }
  return (
    <SafeAreaView style={[{ flex: 1, backgroundColor: theme.colors.bg }, style]} testID={testID}>
      <View style={[{ flex: 1, padding: pad }, contentStyle]}>{children}</View>
    </SafeAreaView>
  );
}

/* ------------------------------------------------------------------ */
/* SectionHeader / Divider / ListRow                                   */
/* ------------------------------------------------------------------ */

export function SectionHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  const { theme } = useTheme();
  const t = theme.typography;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.spacing.sm }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: t.h3.size, fontWeight: t.h3.weight, lineHeight: t.h3.lineHeight, color: theme.colors.ink }}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={{ fontSize: t.bodySm.size, lineHeight: t.bodySm.lineHeight, color: theme.colors.muted, marginTop: 2 }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {action}
    </View>
  );
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  const { theme } = useTheme();
  return <View style={[{ height: 1, backgroundColor: theme.colors.line, marginVertical: theme.spacing.sm }, style]} />;
}

export interface ListRowProps {
  title: string;
  subtitle?: string;
  icon?: IconName;
  onPress?: () => void;
  right?: ReactNode;
  showChevron?: boolean;
  destructive?: boolean;
  accessibilityLabel?: string;
}

export function ListRow({
  title,
  subtitle,
  icon,
  onPress,
  right,
  showChevron = true,
  destructive = false,
  accessibilityLabel,
}: ListRowProps) {
  const { theme } = useTheme();
  const t = theme.typography;
  const color = destructive ? theme.colors.danger : theme.colors.ink;
  const content = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 60,
        paddingVertical: theme.spacing.sm,
        paddingHorizontal: theme.spacing.md,
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius.lg,
      }}
    >
      {icon ? (
        <View
          style={{
            width: 38,
            height: 38,
            borderRadius: theme.radius.sm,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: destructive ? theme.colors.dangerTint : theme.colors.primaryTint,
            marginRight: theme.spacing.md,
          }}
        >
          <Icon name={icon} size={ICON_SIZE.sm} color={destructive ? theme.colors.danger : theme.colors.primaryOnTint} />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: t.body.size, fontWeight: '500', lineHeight: t.body.lineHeight, color }}>{title}</Text>
        {subtitle ? (
          <Text style={{ fontSize: t.bodySm.size, lineHeight: t.bodySm.lineHeight, color: theme.colors.muted, marginTop: 2 }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
      {showChevron && onPress ? (
        <View style={{ marginLeft: theme.spacing.sm }}>
          <Icon name="chevronRight" size={ICON_SIZE.sm} color={theme.colors.faint} />
        </View>
      ) : null}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      style={({ pressed }) => [{ opacity: pressed ? 0.75 : 1 }]}
      android_ripple={{ color: theme.colors.neutralTint }}
    >
      {content}
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/* Buttons                                                             */
/* ------------------------------------------------------------------ */

export interface ButtonProps {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  icon?: IconName;
  fullWidth?: boolean;
  size?: 'md' | 'lg';
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

function useButtonState(disabled?: boolean, loading?: boolean) {
  const { theme } = useTheme();
  const inactive = !!disabled || !!loading;
  return { theme, inactive };
}

function ButtonChrome({
  children,
  onPress,
  disabled,
  loading,
  fullWidth,
  size = 'md',
  accessibilityLabel,
  title,
  style,
  containerStyle,
}: ButtonProps & { children: ReactNode; containerStyle: StyleProp<ViewStyle> }) {
  const { inactive } = useButtonState(disabled, loading);
  const { theme } = useTheme();
  const height = size === 'lg' ? 56 : 50;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: inactive, busy: !!loading }}
      style={({ pressed }) => [
        {
          minHeight: height,
          borderRadius: theme.radius.full,
          paddingHorizontal: theme.spacing.xl,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: inactive ? 0.5 : 1,
          transform: [{ scale: pressed && !inactive ? 0.97 : 1 }],
        },
        fullWidth ? { alignSelf: 'stretch' } : { alignSelf: 'flex-start' },
        containerStyle,
        style,
      ]}
    >
      {children}
    </Pressable>
  );
}

function ButtonLabel({ text, color, loading }: { text: string; color: string; loading?: boolean }) {
  const { theme } = useTheme();
  const t = theme.typography;
  return (
    <Text style={{ fontSize: t.body.size, fontWeight: '700', lineHeight: t.body.lineHeight, color }}>
      {loading ? 'Please wait…' : text}
    </Text>
  );
}

export function PrimaryButton(props: ButtonProps) {
  const { theme } = useTheme();
  const { title, icon, loading } = props;
  return (
    <ButtonChrome
      {...props}
      containerStyle={{ backgroundColor: theme.colors.primary }}
    >
      {loading ? (
        <ActivityIndicator color={theme.colors.onPrimary} style={{ marginRight: theme.spacing.sm }} />
      ) : icon ? (
        <View style={{ marginRight: theme.spacing.sm }}>
          <Icon name={icon} size={ICON_SIZE.sm} color={theme.colors.onPrimary} />
        </View>
      ) : null}
      <ButtonLabel text={title} color={theme.colors.onPrimary} loading={loading} />
    </ButtonChrome>
  );
}

export function SecondaryButton(props: ButtonProps) {
  const { theme } = useTheme();
  const { title, icon, loading } = props;
  return (
    <ButtonChrome
      {...props}
      containerStyle={{ backgroundColor: theme.colors.primaryTint }}
    >
      {loading ? (
        <ActivityIndicator color={theme.colors.primaryOnTint} style={{ marginRight: theme.spacing.sm }} />
      ) : icon ? (
        <View style={{ marginRight: theme.spacing.sm }}>
          <Icon name={icon} size={ICON_SIZE.sm} color={theme.colors.primaryOnTint} />
        </View>
      ) : null}
      <ButtonLabel text={title} color={theme.colors.primaryOnTint} loading={loading} />
    </ButtonChrome>
  );
}

export function GhostButton(props: ButtonProps) {
  const { theme } = useTheme();
  const { title, icon, loading } = props;
  return (
    <ButtonChrome {...props} containerStyle={{ backgroundColor: 'transparent' }}>
      {loading ? (
        <ActivityIndicator color={theme.colors.primary} style={{ marginRight: theme.spacing.sm }} />
      ) : icon ? (
        <View style={{ marginRight: theme.spacing.sm }}>
          <Icon name={icon} size={ICON_SIZE.sm} color={theme.colors.primary} />
        </View>
      ) : null}
      <ButtonLabel text={title} color={theme.colors.primary} loading={loading} />
    </ButtonChrome>
  );
}

export interface IconButtonProps {
  icon: IconName;
  onPress: () => void;
  /** Required: every icon-only button must announce itself. */
  label: string;
  disabled?: boolean;
  variant?: 'plain' | 'filled' | 'outlined' | 'danger';
  size?: number;
  style?: StyleProp<ViewStyle>;
}

export function IconButton({ icon, onPress, label, disabled, variant = 'plain', size = 24, style }: IconButtonProps) {
  const { theme } = useTheme();
  const colors: Record<string, string> = {
    plain: theme.colors.muted,
    filled: theme.colors.onPrimary,
    outlined: theme.colors.ink,
    danger: theme.colors.danger,
  };
  const backgrounds: Record<string, string> = {
    plain: 'transparent',
    filled: theme.colors.primary,
    outlined: 'transparent',
    danger: theme.colors.dangerTint,
  };
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      hitSlop={8}
      style={({ pressed }) => [
        {
          width: 44,
          height: 44,
          borderRadius: theme.radius.full,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: backgrounds[variant],
          ...(variant === 'outlined' ? { borderWidth: 1, borderColor: theme.colors.line } : {}),
          opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
        },
        style,
      ]}
    >
      <Icon name={icon} size={size} color={colors[variant]} accessibilityLabel={label} />
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/* Card                                                                */
/* ------------------------------------------------------------------ */

export interface CardProps {
  children: ReactNode;
  variant?: 'default' | 'elevated' | 'outlined';
  padding?: 'none' | 'sm' | 'md' | 'lg';
  style?: StyleProp<ViewStyle>;
}

export function Card({ children, variant = 'default', padding = 'md', style }: CardProps) {
  const { theme } = useTheme();
  const paddings: Record<string, number> = {
    none: 0,
    sm: theme.spacing.sm,
    md: theme.spacing.lg,
    lg: theme.spacing.xl,
  };
  return (
    <View
      style={[
        {
          backgroundColor: theme.colors.card,
          borderRadius: theme.radius.lg,
          padding: paddings[padding],
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.line,
          ...(variant === 'elevated' ? theme.elevation.md : {}),
          ...(variant === 'outlined' ? { borderWidth: 1 } : {}),
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Badge / StatusBadge — never color-alone: always icon and/or label   */
/* ------------------------------------------------------------------ */

export type BadgeVariant = 'success' | 'info' | 'warn' | 'danger' | 'neutral' | 'primary';

export interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
}

export function Badge({ label, variant = 'neutral', icon, style }: BadgeProps) {
  const { theme } = useTheme();
  const t = theme.typography;
  const c = theme.colors;
  const map: Record<BadgeVariant, { bg: string; fg: string; icon: IconName }> = {
    success: { bg: c.successTint, fg: c.successOnTint, icon: 'check' },
    info: { bg: c.infoTint, fg: c.infoOnTint, icon: 'info' },
    warn: { bg: c.warnTint, fg: c.warnOnTint, icon: 'alertTriangle' },
    danger: { bg: c.dangerTint, fg: c.dangerOnTint, icon: 'alertTriangle' },
    neutral: { bg: c.neutralTint, fg: c.neutralOnTint, icon: 'info' },
    primary: { bg: c.primaryTint, fg: c.primaryOnTint, icon: 'check' },
  };
  const m = map[variant];
  const glyph = icon ?? m.icon;
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={label}
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          alignSelf: 'flex-start',
          backgroundColor: m.bg,
          borderRadius: theme.radius.full,
          paddingHorizontal: theme.spacing.sm,
          paddingVertical: 4,
        },
        style,
      ]}
    >
      <Icon name={glyph} size={ICON_SIZE.xs} color={m.fg} />
      <Text
        style={{
          fontSize: t.caption.size,
          fontWeight: '700',
          lineHeight: t.caption.lineHeight,
          color: m.fg,
          marginLeft: 4,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

/** Semantic alias of Badge for statuses (booking state, readiness, …). */
export function StatusBadge({
  status,
  label,
  icon,
  style,
}: {
  status: 'success' | 'info' | 'warn' | 'danger' | 'neutral';
  label: string;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
}) {
  return <Badge label={label} variant={status} icon={icon} style={style} />;
}

/* ------------------------------------------------------------------ */
/* ProgressStepper — numbered steps: done / active / todo              */
/* ------------------------------------------------------------------ */

export interface ProgressStepperProps {
  steps: string[];
  /** 0-based index of the current step. */
  current: number;
  accessibilityLabel?: string;
}

export function ProgressStepper({ steps, current, accessibilityLabel }: ProgressStepperProps) {
  const { theme } = useTheme();
  const t = theme.typography;
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel ?? `Step ${Math.min(current + 1, steps.length)} of ${steps.length}`}
      style={{ flexDirection: 'row', alignItems: 'flex-start' }}
    >
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        const last = i === steps.length - 1;
        return (
          <View key={label} style={{ flex: 1, alignItems: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', width: '100%' }}>
              <View style={{ flex: 1, height: 2, backgroundColor: i === 0 ? 'transparent' : done || active ? theme.colors.primary : theme.colors.line }} />
              <View
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: done ? theme.colors.primary : active ? theme.colors.primaryTint : 'transparent',
                  borderWidth: done ? 0 : 1.5,
                  borderColor: active ? theme.colors.primary : theme.colors.line,
                }}
              >
                {done ? (
                  <Icon name="check" size={ICON_SIZE.xs} color={theme.colors.onPrimary} />
                ) : (
                  <Text
                    style={{
                      fontSize: t.bodySm.size,
                      fontWeight: '700',
                      color: active ? theme.colors.primaryOnTint : theme.colors.faint,
                    }}
                  >
                    {i + 1}
                  </Text>
                )}
              </View>
              <View style={{ flex: 1, height: 2, backgroundColor: last ? 'transparent' : done ? theme.colors.primary : theme.colors.line }} />
            </View>
            <Text
              style={{
                fontSize: t.caption.size,
                fontWeight: active ? '700' : '500',
                lineHeight: t.caption.lineHeight,
                color: active ? theme.colors.ink : done ? theme.colors.muted : theme.colors.faint,
                textAlign: 'center',
                marginTop: theme.spacing.xs,
                paddingHorizontal: 2,
              }}
            >
              {label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* BottomSheet — modal sheet, backdrop-tap dismiss                     */
/* ------------------------------------------------------------------ */

export interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

export function BottomSheet({ visible, onClose, title, children }: BottomSheetProps) {
  const { theme } = useTheme();
  const t = theme.typography;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable
        style={{ flex: 1, backgroundColor: theme.colors.overlay, justifyContent: 'flex-end' }}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Dismiss sheet"
      >
        <Pressable
          onPress={() => {}}
          accessibilityViewIsModal
          style={{
            backgroundColor: theme.colors.surface,
            borderTopLeftRadius: theme.radius.xl,
            borderTopRightRadius: theme.radius.xl,
            ...theme.elevation.lg,
            padding: theme.spacing.lg,
            paddingBottom: theme.spacing.xxl,
            maxHeight: '85%',
          }}
        >
          <View
            style={{
              width: 40,
              height: 4,
              borderRadius: 2,
              backgroundColor: theme.colors.line,
              alignSelf: 'center',
              marginBottom: theme.spacing.md,
            }}
          />
          {title ? (
            <Text
              style={{
                fontSize: t.h3.size,
                fontWeight: t.h3.weight,
                lineHeight: t.h3.lineHeight,
                color: theme.colors.ink,
                marginBottom: theme.spacing.md,
              }}
            >
              {title}
            </Text>
          ) : null}
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* AppDialog — title / message / actions (incl. destructive)           */
/* ------------------------------------------------------------------ */

export interface DialogAction {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'danger' | 'ghost';
  disabled?: boolean;
}

export interface AppDialogProps {
  visible: boolean;
  title: string;
  message: string;
  actions: DialogAction[];
  onDismiss: () => void;
}

export function AppDialog({ visible, title, message, actions, onDismiss }: AppDialogProps) {
  const { theme } = useTheme();
  const t = theme.typography;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss} statusBarTranslucent>
      <Pressable
        style={{ flex: 1, backgroundColor: theme.colors.overlay, alignItems: 'center', justifyContent: 'center', padding: theme.spacing.xl }}
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel="Dismiss dialog"
      >
        <Pressable
          onPress={() => {}}
          accessibilityViewIsModal
          accessibilityRole="alert"
          style={{
            width: '100%',
            maxWidth: 400,
            backgroundColor: theme.colors.surface,
            borderRadius: theme.radius.xl,
            padding: theme.spacing.xl,
            ...theme.elevation.lg,
          }}
        >
          <Text style={{ fontSize: t.h2.size, fontWeight: t.h2.weight, lineHeight: t.h2.lineHeight, color: theme.colors.ink }}>
            {title}
          </Text>
          <Text
            style={{
              fontSize: t.body.size,
              lineHeight: t.body.lineHeight,
              color: theme.colors.muted,
              marginTop: theme.spacing.sm,
              marginBottom: theme.spacing.lg,
            }}
          >
            {message}
          </Text>
          <View style={{ gap: theme.spacing.sm }}>
            {actions.map((a) => {
              if (a.variant === 'danger') {
                return (
                  <Pressable
                    key={a.label}
                    onPress={a.onPress}
                    disabled={a.disabled}
                    accessibilityRole="button"
                    accessibilityLabel={a.label}
                    style={({ pressed }) => ({
                      minHeight: 50,
                      borderRadius: theme.radius.full,
                      backgroundColor: theme.colors.danger,
                      alignItems: 'center',
                      justifyContent: 'center',
                      opacity: a.disabled ? 0.5 : pressed ? 0.85 : 1,
                    })}
                  >
                    <Text style={{ fontSize: t.body.size, fontWeight: '700', color: theme.colors.onDanger }}>{a.label}</Text>
                  </Pressable>
                );
              }
              const Cmp = a.variant === 'ghost' ? GhostButton : PrimaryButton;
              return <Cmp key={a.label} title={a.label} onPress={a.onPress} disabled={a.disabled} fullWidth />;
            })}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Snackbar — queued, auto-dismiss, optional action                    */
/* ------------------------------------------------------------------ */

export interface SnackbarOptions {
  actionLabel?: string;
  onAction?: () => void;
  /** ms before auto-dismiss (default 3500). */
  duration?: number;
}

interface SnackItem extends SnackbarOptions {
  id: number;
  message: string;
}

const SnackbarContext = createContext<(message: string, opts?: SnackbarOptions) => void>(() => {});

/** Show a snackbar from anywhere inside the provider. */
export function useSnackbar(): (message: string, opts?: SnackbarOptions) => void {
  return useContext(SnackbarContext);
}

export function SnackbarProvider({ children }: { children: ReactNode }) {
  const { theme } = useTheme();
  const t = theme.typography;
  const [items, setItems] = useState<SnackItem[]>([]);
  const idRef = useRef(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const show = useCallback((message: string, opts: SnackbarOptions = {}) => {
    const id = ++idRef.current;
    const duration = opts.duration ?? 3500;
    setItems((prev) => [...prev.slice(-2), { id, message, ...opts }]);
    const timer = setTimeout(() => {
      setItems((prev) => prev.filter((i) => i.id !== id));
    }, duration);
    timers.current.push(timer);
  }, []);

  return (
    <SnackbarContext.Provider value={show}>
      {children}
      <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
        <View style={{ flex: 1, justifyContent: 'flex-end', alignItems: 'center', padding: theme.spacing.lg }}>
          {items.map((item) => (
            <View
              key={item.id}
              accessibilityRole="alert"
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: theme.colors.ink,
                borderRadius: theme.radius.full,
                paddingHorizontal: theme.spacing.lg,
                paddingVertical: theme.spacing.md,
                marginTop: theme.spacing.sm,
                maxWidth: '100%',
                ...theme.elevation.md,
              }}
            >
              <Text
                style={{
                  flex: 1,
                  fontSize: t.bodySm.size,
                  fontWeight: '500',
                  lineHeight: t.bodySm.lineHeight,
                  color: theme.colors.bg,
                }}
              >
                {item.message}
              </Text>
              {item.actionLabel ? (
                <Pressable
                  onPress={() => {
                    item.onAction?.();
                    setItems((prev) => prev.filter((i) => i.id !== item.id));
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={item.actionLabel}
                  hitSlop={8}
                  style={{ marginLeft: theme.spacing.md, paddingVertical: 4 }}
                >
                  <Text style={{ fontSize: t.bodySm.size, fontWeight: '800', color: theme.colors.bg }}>
                    {item.actionLabel.toUpperCase()}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ))}
        </View>
      </View>
    </SnackbarContext.Provider>
  );
}

/* ------------------------------------------------------------------ */
/* Skeleton — shimmer-ish placeholder (opacity pulse)                  */
/* ------------------------------------------------------------------ */

export interface SkeletonProps {
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

export function Skeleton({ width = '100%', height = 16, radius: r, style, accessibilityLabel }: SkeletonProps) {
  const { theme } = useTheme();
  const opacity = useRef(new Animated.Value(0.35)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: theme.motion.slow, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.35, duration: theme.motion.slow, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity, theme.motion.slow]);
  return (
    <Animated.View
      accessible={!!accessibilityLabel}
      accessibilityLabel={accessibilityLabel ?? 'Loading'}
      style={[
        {
          width,
          height,
          borderRadius: r ?? theme.radius.sm,
          backgroundColor: theme.colors.surface2,
          opacity,
        },
        style,
      ]}
    />
  );
}

/* ------------------------------------------------------------------ */
/* EmptyState / ErrorState                                             */
/* ------------------------------------------------------------------ */

export interface EmptyStateProps {
  icon: IconName;
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ icon, title, message, actionLabel, onAction }: EmptyStateProps) {
  const { theme } = useTheme();
  const t = theme.typography;
  return (
    <View style={{ alignItems: 'center', padding: theme.spacing.xxl }}>
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: 36,
          backgroundColor: theme.colors.surface2,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: theme.spacing.lg,
        }}
      >
        <Icon name={icon} size={ICON_SIZE.xl} color={theme.colors.muted} />
      </View>
      <Text style={{ fontSize: t.h3.size, fontWeight: t.h3.weight, color: theme.colors.ink, textAlign: 'center' }}>{title}</Text>
      <Text
        style={{
          fontSize: t.bodySm.size,
          lineHeight: t.bodySm.lineHeight,
          color: theme.colors.muted,
          textAlign: 'center',
          marginTop: theme.spacing.sm,
          marginBottom: actionLabel ? theme.spacing.lg : 0,
        }}
      >
        {message}
      </Text>
      {actionLabel && onAction ? <PrimaryButton title={actionLabel} onPress={onAction} icon="plus" /> : null}
    </View>
  );
}

export interface ErrorStateProps {
  message: string;
  title?: string;
  onRetry?: () => void;
  retryLabel?: string;
  /** Icon for the retry button — defaults to refresh; use arrowLeft for back navigation. */
  retryIcon?: IconName;
}

export function ErrorState({ message, title = 'Something went wrong', onRetry, retryLabel = 'Try again', retryIcon = 'refresh' }: ErrorStateProps) {
  const { theme } = useTheme();
  const t = theme.typography;
  return (
    <View style={{ alignItems: 'center', padding: theme.spacing.xxl }}>
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: 36,
          backgroundColor: theme.colors.dangerTint,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: theme.spacing.lg,
        }}
      >
        <Icon name="alertTriangle" size={ICON_SIZE.xl} color={theme.colors.danger} />
      </View>
      <Text style={{ fontSize: t.h3.size, fontWeight: t.h3.weight, color: theme.colors.ink, textAlign: 'center' }}>{title}</Text>
      <Text
        style={{
          fontSize: t.bodySm.size,
          lineHeight: t.bodySm.lineHeight,
          color: theme.colors.muted,
          textAlign: 'center',
          marginTop: theme.spacing.sm,
          marginBottom: onRetry ? theme.spacing.lg : 0,
        }}
      >
        {message}
      </Text>
      {onRetry ? <SecondaryButton title={retryLabel} onPress={onRetry} icon={retryIcon} /> : null}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Countdown — HH:MM:SS digit display                                  */
/* ------------------------------------------------------------------ */

export interface CountdownProps {
  /** Seconds remaining. */
  seconds: number;
  size?: 'sm' | 'md' | 'lg';
  /** Small caption above the digits, e.g. "Tatkal window opens in". */
  caption?: string;
  /** State line under the digits, e.g. "Window open — your final action". */
  stateText?: string;
  stateVariant?: 'info' | 'success' | 'warn';
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

export function Countdown({ seconds, size = 'md', caption, stateText, stateVariant = 'info' }: CountdownProps) {
  const { theme } = useTheme();
  const t = theme.typography;
  const clamped = Math.max(0, Math.floor(seconds));
  const hh = Math.floor(clamped / 3600);
  const mm = Math.floor((clamped % 3600) / 60);
  const ss = clamped % 60;
  const dims = {
    sm: { box: 44, font: 18, gap: 6 },
    md: { box: 60, font: 26, gap: 8 },
    lg: { box: 76, font: 34, gap: 10 },
  }[size];
  const units: Array<[string, string]> = [
    [pad2(hh), 'HRS'],
    [pad2(mm), 'MIN'],
    [pad2(ss), 'SEC'],
  ];
  const stateColors = {
    info: theme.colors.info,
    success: theme.colors.success,
    warn: theme.colors.warn,
  };
  return (
    <View
      accessibilityRole="timer"
      accessibilityLabel={caption ? `${caption}: ${hh} hours ${mm} minutes ${ss} seconds` : `${hh} hours ${mm} minutes ${ss} seconds`}
      style={{ alignItems: 'center' }}
    >
      {caption ? (
        <Text
          style={{
            fontSize: t.bodySm.size,
            fontWeight: '600',
            lineHeight: t.bodySm.lineHeight,
            color: theme.colors.muted,
            marginBottom: theme.spacing.sm,
          }}
        >
          {caption}
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {units.map(([digits, label], i) => (
          <View key={label} style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ alignItems: 'center' }}>
              <View
                style={{
                  width: dims.box,
                  height: dims.box,
                  borderRadius: theme.radius.lg,
                  backgroundColor: theme.colors.primaryTint,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text
                  style={{
                    fontSize: dims.font,
                    fontWeight: '800',
                    fontFamily: t.mono.fontFamily,
                    color: theme.colors.primaryOnTint,
                  }}
                >
                  {digits}
                </Text>
              </View>
              <Text
                style={{
                  fontSize: t.caption.size,
                  fontWeight: '700',
                  color: theme.colors.faint,
                  marginTop: 4,
                  letterSpacing: 1,
                }}
              >
                {label}
              </Text>
            </View>
            {i < units.length - 1 ? (
              <Text style={{ fontSize: dims.font, fontWeight: '700', color: theme.colors.faint, marginHorizontal: dims.gap / 2, marginTop: -18 }}>
                :
              </Text>
            ) : null}
          </View>
        ))}
      </View>
      {stateText ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: theme.spacing.sm }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: stateColors[stateVariant], marginRight: 6 }} />
          <Text style={{ fontSize: t.bodySm.size, fontWeight: '600', color: stateColors[stateVariant] }}>{stateText}</Text>
        </View>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* ReadinessCard — checklist with progress bar                         */
/* ------------------------------------------------------------------ */

export interface ReadinessItem {
  label: string;
  done: boolean;
}

export interface ReadinessCardProps {
  title?: string;
  items: ReadinessItem[];
}

export function ReadinessCard({ title = 'Booking readiness', items }: ReadinessCardProps) {
  const { theme } = useTheme();
  const t = theme.typography;
  const done = items.filter((i) => i.done).length;
  const total = items.length;
  const pct = total === 0 ? 0 : done / total;
  const state: 'ready' | 'almost' | 'starting' = pct >= 1 ? 'ready' : pct >= 0.5 ? 'almost' : 'starting';
  const stateMeta = {
    ready: { label: 'Ready — you are prepared', color: theme.colors.success, icon: 'check' as IconName },
    almost: { label: 'Almost ready', color: theme.colors.warn, icon: 'clock' as IconName },
    starting: { label: "Let's get you prepared", color: theme.colors.info, icon: 'info' as IconName },
  }[state];
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.spacing.md }}>
        <Text style={{ fontSize: t.h3.size, fontWeight: t.h3.weight, color: theme.colors.ink }}>{title}</Text>
        <Badge label={`${done}/${total}`} variant={state === 'ready' ? 'success' : state === 'almost' ? 'warn' : 'info'} icon={stateMeta.icon} />
      </View>
      <View style={{ marginBottom: theme.spacing.md }}>
        {items.map((item) => (
          <View key={item.label} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: theme.spacing.xs }}>
            <View
              style={{
                width: 22,
                height: 22,
                borderRadius: 11,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: item.done ? theme.colors.success : 'transparent',
                borderWidth: item.done ? 0 : 1.5,
                borderColor: theme.colors.line,
                marginRight: theme.spacing.sm,
              }}
            >
              {item.done ? <Icon name="check" size={ICON_SIZE.xs} color={theme.colors.bg} /> : null}
            </View>
            <Text
              style={{
                fontSize: t.bodySm.size,
                lineHeight: t.bodySm.lineHeight,
                color: item.done ? theme.colors.ink : theme.colors.muted,
                fontWeight: item.done ? '600' : '400',
              }}
            >
              {item.label}
            </Text>
          </View>
        ))}
      </View>
      <View
        accessibilityRole="progressbar"
        accessibilityValue={{ now: Math.round(pct * 100), min: 0, max: 100 }}
        style={{ height: 8, borderRadius: 4, backgroundColor: theme.colors.surface2, overflow: 'hidden', marginBottom: theme.spacing.sm }}
      >
        <View style={{ width: `${Math.round(pct * 100)}%`, height: 8, borderRadius: 4, backgroundColor: stateMeta.color }} />
      </View>
      <Text style={{ fontSize: t.bodySm.size, fontWeight: '700', color: stateMeta.color }}>{stateMeta.label}</Text>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Data-display cards (Edit/Delete as labeled IconButtons)             */
/* ------------------------------------------------------------------ */

function CardActions({ onEdit, onDelete, editLabel, deleteLabel }: {
  onEdit?: () => void;
  onDelete?: () => void;
  editLabel: string;
  deleteLabel: string;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 8 }}>
      {onEdit ? <IconButton icon="edit" onPress={onEdit} label={editLabel} variant="plain" size={ICON_SIZE.sm} /> : null}
      {onDelete ? <IconButton icon="trash" onPress={onDelete} label={deleteLabel} variant="danger" size={ICON_SIZE.sm} /> : null}
    </View>
  );
}

export interface TripCardProps {
  fromLabel: string;
  toLabel: string;
  dateLabel: string;
  trainLabel?: string;
  onEdit?: () => void;
  onDelete?: () => void;
}

export function TripCard({ fromLabel, toLabel, dateLabel, trainLabel, onEdit, onDelete }: TripCardProps) {
  const { theme } = useTheme();
  const t = theme.typography;
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ marginRight: theme.spacing.md }}>
          <Icon name="train" size={ICON_SIZE.lg} color={theme.colors.primary} accessibilityLabel="Trip" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: t.body.size, fontWeight: '700', lineHeight: t.body.lineHeight, color: theme.colors.ink }}>
            {fromLabel} → {toLabel}
          </Text>
          <Text style={{ fontSize: t.bodySm.size, lineHeight: t.bodySm.lineHeight, color: theme.colors.muted, marginTop: 2 }}>
            {dateLabel}
            {trainLabel ? ` · ${trainLabel}` : ''}
          </Text>
        </View>
        <CardActions onEdit={onEdit} onDelete={onDelete} editLabel="Edit trip" deleteLabel="Delete trip" />
      </View>
    </Card>
  );
}

export interface PassengerCardProps {
  name: string;
  age: number | string;
  genderLabel: string;
  berthLabel: string;
  onEdit?: () => void;
  onDelete?: () => void;
}

export function PassengerCard({ name, age, genderLabel, berthLabel, onEdit, onDelete }: PassengerCardProps) {
  const { theme } = useTheme();
  const t = theme.typography;
  return (
    <Card padding="md">
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: theme.colors.primaryTint,
            alignItems: 'center',
            justifyContent: 'center',
            marginRight: theme.spacing.md,
          }}
        >
          <Icon name="users" size={ICON_SIZE.sm} color={theme.colors.primaryOnTint} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: t.body.size, fontWeight: '700', lineHeight: t.body.lineHeight, color: theme.colors.ink }}>
            {name}
          </Text>
          <Text style={{ fontSize: t.bodySm.size, lineHeight: t.bodySm.lineHeight, color: theme.colors.muted, marginTop: 2 }}>
            Age {age} · {genderLabel} · {berthLabel}
          </Text>
        </View>
        <CardActions onEdit={onEdit} onDelete={onDelete} editLabel={`Edit passenger ${name}`} deleteLabel={`Delete passenger ${name}`} />
      </View>
    </Card>
  );
}

export interface TrainCardProps {
  trainName: string;
  trainNo: string;
  fromCode: string;
  toCode: string;
  departure: string;
  arrival: string;
  duration?: string;
  selected?: boolean;
  onSelect?: () => void;
}

export function TrainCard({
  trainName,
  trainNo,
  fromCode,
  toCode,
  departure,
  arrival,
  duration,
  selected,
  onSelect,
}: TrainCardProps) {
  const { theme } = useTheme();
  const t = theme.typography;
  const body = (
    <Card variant={selected ? 'outlined' : 'default'} style={selected ? { borderColor: theme.colors.primary, borderWidth: 1.5 } : undefined}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: t.body.size, fontWeight: '700', lineHeight: t.body.lineHeight, color: theme.colors.ink }}>
            {trainName}
          </Text>
          <Text
            style={{
              fontSize: t.caption.size,
              fontWeight: '600',
              fontFamily: t.mono.fontFamily,
              color: theme.colors.muted,
              marginTop: 2,
            }}
          >
            {trainNo}
          </Text>
        </View>
        {selected ? <Badge label="Selected" variant="primary" /> : null}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: theme.spacing.md }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: t.h3.size, fontWeight: '700', color: theme.colors.ink }}>{departure}</Text>
          <Text style={{ fontSize: t.caption.size, fontWeight: '700', color: theme.colors.muted, letterSpacing: 1 }}>{fromCode}</Text>
        </View>
        <View style={{ flex: 2, alignItems: 'center' }}>
          <View style={{ height: 2, backgroundColor: theme.colors.line, width: '80%', borderRadius: 1 }} />
          {duration ? (
            <Text style={{ fontSize: t.caption.size, color: theme.colors.faint, marginTop: 4 }}>{duration}</Text>
          ) : null}
        </View>
        <View style={{ flex: 1, alignItems: 'flex-end' }}>
          <Text style={{ fontSize: t.h3.size, fontWeight: '700', color: theme.colors.ink }}>{arrival}</Text>
          <Text style={{ fontSize: t.caption.size, fontWeight: '700', color: theme.colors.muted, letterSpacing: 1 }}>{toCode}</Text>
        </View>
      </View>
    </Card>
  );
  if (!onSelect) return body;
  return (
    <Pressable
      onPress={onSelect}
      accessibilityRole="radio"
      accessibilityState={{ selected: !!selected }}
      accessibilityLabel={`Select train ${trainName}, ${trainNo}`}
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
    >
      {body}
    </Pressable>
  );
}

export interface PNRCardProps {
  pnr: string;
  statusText: string;
  status: 'success' | 'info' | 'warn' | 'danger' | 'neutral';
  trainLabel?: string;
  onRefresh?: () => void;
}

export function PNRCard({ pnr, statusText, status, trainLabel, onRefresh }: PNRCardProps) {
  const { theme } = useTheme();
  const t = theme.typography;
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View>
          <Text style={{ fontSize: t.caption.size, fontWeight: '700', color: theme.colors.muted, letterSpacing: 1 }}>PNR</Text>
          <Text
            style={{
              fontSize: t.h2.size,
              fontWeight: t.mono.weight,
              fontFamily: t.mono.fontFamily,
              color: theme.colors.ink,
              letterSpacing: 2,
            }}
          >
            {pnr}
          </Text>
          {trainLabel ? (
            <Text style={{ fontSize: t.bodySm.size, color: theme.colors.muted, marginTop: 2 }}>{trainLabel}</Text>
          ) : null}
        </View>
        {onRefresh ? <IconButton icon="refresh" onPress={onRefresh} label="Refresh PNR status" variant="outlined" size={ICON_SIZE.sm} /> : null}
      </View>
      <View style={{ marginTop: theme.spacing.md }}>
        <StatusBadge status={status} label={statusText} />
      </View>
    </Card>
  );
}

export interface BookingCardProps {
  title: string;
  subtitle?: string;
  status: 'success' | 'info' | 'warn' | 'danger' | 'neutral';
  statusLabel: string;
  icon?: IconName;
  onPress?: () => void;
}

export function BookingCard({ title, subtitle, status, statusLabel, icon = 'ticket', onPress }: BookingCardProps) {
  const { theme } = useTheme();
  const t = theme.typography;
  const body = (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ marginRight: theme.spacing.md }}>
          <Icon name={icon} size={ICON_SIZE.lg} color={theme.colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: t.body.size, fontWeight: '700', lineHeight: t.body.lineHeight, color: theme.colors.ink }}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={{ fontSize: t.bodySm.size, lineHeight: t.bodySm.lineHeight, color: theme.colors.muted, marginTop: 2 }}>
              {subtitle}
            </Text>
          ) : null}
          <View style={{ marginTop: theme.spacing.sm }}>
            <StatusBadge status={status} label={statusLabel} />
          </View>
        </View>
        {onPress ? <Icon name="chevronRight" size={ICON_SIZE.sm} color={theme.colors.faint} /> : null}
      </View>
    </Card>
  );
  if (!onPress) return body;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
    >
      {body}
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/* AutomationStatus — live list of step rows                           */
/* ------------------------------------------------------------------ */

export type AutomationStepState = 'done' | 'active' | 'pending' | 'waiting';

export interface AutomationStep {
  label: string;
  detail?: string;
  state: AutomationStepState;
}

export function AutomationStatus({ steps }: { steps: AutomationStep[] }) {
  const { theme } = useTheme();
  const t = theme.typography;
  return (
    <Card padding="sm">
      {steps.map((step, i) => {
        const last = i === steps.length - 1;
        const meta: Record<AutomationStepState, { icon: IconName; bg: string; fg: string; text: string }> = {
          done: { icon: 'check', bg: theme.colors.success, fg: theme.colors.bg, text: theme.colors.muted },
          active: { icon: 'refresh', bg: theme.colors.primaryTint, fg: theme.colors.primaryOnTint, text: theme.colors.ink },
          pending: { icon: 'clock', bg: theme.colors.surface2, fg: theme.colors.faint, text: theme.colors.faint },
          waiting: { icon: 'bell', bg: theme.colors.warnTint, fg: theme.colors.warnOnTint, text: theme.colors.ink },
        };
        const m = meta[step.state];
        return (
          <View key={`${step.label}-${i}`}>
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: theme.spacing.sm, paddingHorizontal: theme.spacing.sm }}>
              <View
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  backgroundColor: m.bg,
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginRight: theme.spacing.md,
                }}
              >
                <Icon name={m.icon} size={ICON_SIZE.xs} color={m.fg} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: t.bodySm.size, fontWeight: step.state === 'pending' ? '400' : '600', color: m.text }}>
                  {step.label}
                </Text>
                {step.detail ? (
                  <Text style={{ fontSize: t.caption.size, lineHeight: t.caption.lineHeight, color: theme.colors.muted, marginTop: 2 }}>
                    {step.detail}
                  </Text>
                ) : null}
                {step.state === 'waiting' ? (
                  <Text style={{ fontSize: t.caption.size, fontWeight: '700', color: theme.colors.warnOnTint, marginTop: 2 }}>
                    Waiting on you
                  </Text>
                ) : null}
              </View>
            </View>
            {!last ? <View style={{ height: 1, backgroundColor: theme.colors.line, marginLeft: 48 }} /> : null}
          </View>
        );
      })}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* InterventionCard — CAPTCHA / OTP / payment / unknown-screen states  */
/* ------------------------------------------------------------------ */

export type InterventionKind = 'captcha' | 'otp' | 'payment' | 'unknown';

const INTERVENTION_COPY: Record<InterventionKind, { icon: IconName; title: string; message: string; primaryLabel: string }> = {
  captcha: {
    icon: 'shield',
    title: 'Quick human check needed',
    message:
      'IRCTC is asking for a CAPTCHA. Solve it in the IRCTC window — your trip stays prepared and Copilot picks up right after.',
    primaryLabel: 'Open IRCTC window',
  },
  otp: {
    icon: 'bell',
    title: 'OTP needed from you',
    message:
      'IRCTC sent an OTP to your phone. Enter it in the IRCTC window to continue — Copilot never reads or fills OTPs by itself.',
    primaryLabel: 'Open IRCTC window',
  },
  payment: {
    icon: 'card',
    title: 'Payment is your final action',
    message:
      "Complete the payment on IRCTC's own page. Copilot never touches your payment details — you stay in control.",
    primaryLabel: 'Open IRCTC window',
  },
  unknown: {
    icon: 'helpCircle',
    title: 'IRCTC needs your attention',
    message:
      'Something unexpected appeared in the IRCTC window. Take a look and continue — your prepared details are safe.',
    primaryLabel: 'Open IRCTC window',
  },
};

export interface InterventionCardProps {
  kind: InterventionKind;
  title?: string;
  message?: string;
  primaryLabel?: string;
  onPrimary: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
}

export function InterventionCard({
  kind,
  title,
  message,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
}: InterventionCardProps) {
  const { theme } = useTheme();
  const t = theme.typography;
  const copy = INTERVENTION_COPY[kind];
  return (
    <Card variant="elevated">
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: theme.spacing.md }}>
        <View
          style={{
            width: 48,
            height: 48,
            borderRadius: 24,
            backgroundColor: theme.colors.warnTint,
            alignItems: 'center',
            justifyContent: 'center',
            marginRight: theme.spacing.md,
          }}
        >
          <Icon name={copy.icon} size={ICON_SIZE.md} color={theme.colors.warnOnTint} accessibilityLabel={title ?? copy.title} />
        </View>
        <Text style={{ flex: 1, fontSize: t.h3.size, fontWeight: t.h3.weight, lineHeight: t.h3.lineHeight, color: theme.colors.ink }}>
          {title ?? copy.title}
        </Text>
      </View>
      <Text style={{ fontSize: t.body.size, lineHeight: t.body.lineHeight, color: theme.colors.muted, marginBottom: theme.spacing.lg }}>
        {message ?? copy.message}
      </Text>
      <View style={{ gap: theme.spacing.sm }}>
        <PrimaryButton title={primaryLabel ?? copy.primaryLabel} onPress={onPrimary} icon="externalLink" fullWidth />
        {secondaryLabel && onSecondary ? <GhostButton title={secondaryLabel} onPress={onSecondary} fullWidth /> : null}
      </View>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* SecureVaultCard — privacy reassurance row                           */
/* ------------------------------------------------------------------ */

export function SecureVaultCard() {
  const { theme } = useTheme();
  const t = theme.typography;
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel="Privacy: your details are stored encrypted on this device only."
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius.md,
        padding: theme.spacing.md,
        borderWidth: 1,
        borderColor: theme.colors.line,
      }}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: theme.colors.successTint,
          alignItems: 'center',
          justifyContent: 'center',
          marginRight: theme.spacing.md,
        }}
      >
        <Icon name="lock" size={ICON_SIZE.sm} color={theme.colors.successOnTint} accessibilityLabel="Locked" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: t.bodySm.size, fontWeight: '700', lineHeight: t.bodySm.lineHeight, color: theme.colors.ink }}>
          Stored encrypted on this device
        </Text>
        <Text style={{ fontSize: t.caption.size, lineHeight: t.caption.lineHeight, color: theme.colors.muted, marginTop: 2 }}>
          No cloud, no tracking. Your details never leave your phone.
        </Text>
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Field wrappers                                                      */
/* ------------------------------------------------------------------ */

export interface LabeledInputProps extends Omit<TextInputProps, 'style'> {
  label: string;
  error?: string;
  hint?: string;
  inputStyle?: StyleProp<TextStyle>;
  containerStyle?: StyleProp<ViewStyle>;
}

export function LabeledInput({ label, error, hint, inputStyle, containerStyle, ...rest }: LabeledInputProps) {
  const { theme } = useTheme();
  const t = theme.typography;
  const [focused, setFocused] = useState(false);
  return (
    <View style={containerStyle}>
      <Text
        style={{
          fontSize: t.bodySm.size,
          fontWeight: '600',
          lineHeight: t.bodySm.lineHeight,
          color: theme.colors.ink,
          marginBottom: theme.spacing.xs,
        }}
      >
        {label}
      </Text>
      <TextInput
        {...rest}
        accessibilityLabel={rest.accessibilityLabel ?? label}
        placeholderTextColor={theme.colors.faint}
        onFocus={(e) => {
          setFocused(true);
          rest.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          rest.onBlur?.(e);
        }}
        style={[
          {
            minHeight: 52,
            backgroundColor: focused ? theme.colors.surface : theme.colors.surface2,
            borderWidth: 1.5,
            borderColor: error ? theme.colors.danger : focused ? theme.colors.primary : 'transparent',
            borderRadius: theme.radius.md,
            paddingHorizontal: theme.spacing.md,
            paddingVertical: theme.spacing.sm,
            fontSize: t.body.size,
            lineHeight: t.body.lineHeight,
            color: theme.colors.ink,
          },
          inputStyle,
        ]}
      />
      {error ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: theme.spacing.xs }}>
          <Icon name="alertTriangle" size={ICON_SIZE.xs} color={theme.colors.danger} />
          <Text
            accessibilityRole="alert"
            style={{
              fontSize: t.caption.size,
              fontWeight: '600',
              lineHeight: t.caption.lineHeight,
              color: theme.colors.danger,
              marginLeft: 4,
              flex: 1,
            }}
          >
            {error}
          </Text>
        </View>
      ) : hint ? (
        <Text
          style={{
            fontSize: t.caption.size,
            lineHeight: t.caption.lineHeight,
            color: theme.colors.muted,
            marginTop: theme.spacing.xs,
          }}
        >
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedControlProps<T extends string> {
  label: string;
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  style?: StyleProp<ViewStyle>;
}

export function SegmentedControl<T extends string>({ label, options, value, onChange, style }: SegmentedControlProps<T>) {
  const { theme } = useTheme();
  const t = theme.typography;
  return (
    <View style={style} accessibilityRole="radiogroup" accessibilityLabel={label}>
      <Text
        style={{
          fontSize: t.bodySm.size,
          fontWeight: '600',
          lineHeight: t.bodySm.lineHeight,
          color: theme.colors.ink,
          marginBottom: theme.spacing.sm,
        }}
      >
        {label}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
        {options.map((opt) => {
          const selected = opt.value === value;
          return (
            <Pressable
              key={opt.value}
              onPress={() => onChange(opt.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={opt.label}
              style={({ pressed }) => ({
                minHeight: 44,
                paddingHorizontal: theme.spacing.lg,
                paddingVertical: theme.spacing.sm,
                borderRadius: theme.radius.full,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: selected ? theme.colors.primary : theme.colors.surface2,
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <Text
                style={{
                  fontSize: t.bodySm.size,
                  fontWeight: '700',
                  lineHeight: t.bodySm.lineHeight,
                  color: selected ? theme.colors.onPrimary : theme.colors.ink,
                }}
              >
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* 2026-10 redesign — app-bar, avatar, chips, story-style actions      */
/* ------------------------------------------------------------------ */

export interface HeaderAction {
  icon: IconName;
  label: string;
  onPress: () => void;
  /** Small dot on the icon (unread / attention). */
  dot?: boolean;
}

export interface AppHeaderProps {
  title: string;
  subtitle?: string;
  /** Shows a back arrow on the left (top-left, where people expect it). */
  onBack?: () => void;
  actions?: HeaderAction[];
  /** 'large' = tab-root title (Instagram/YouTube style); 'compact' = pushed screen. */
  variant?: 'large' | 'compact';
  /** Hide the theme (light/dark) toggle at the top-right. */
  hideThemeToggle?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Top app bar. Put it as the first child of <Screen>. */
export function AppHeader({ title, subtitle, onBack, actions = [], variant, hideThemeToggle, style }: AppHeaderProps) {
  const { theme, mode, toggle } = useTheme();
  const t = theme.typography;
  const large = (variant ?? (onBack ? 'compact' : 'large')) === 'large';
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          minHeight: 56,
          marginBottom: large ? theme.spacing.md : theme.spacing.sm,
          marginTop: -theme.spacing.xs,
        },
        style,
      ]}
    >
      {onBack ? (
        <IconButton
          icon="arrowLeft"
          onPress={onBack}
          label="Go back"
          variant="plain"
          style={{ marginLeft: -theme.spacing.sm, marginRight: theme.spacing.xs }}
        />
      ) : null}
      <View style={{ flex: 1 }}>
        <Text
          accessibilityRole="header"
          numberOfLines={1}
          style={{
            fontSize: large ? t.h1.size : t.h3.size + 2,
            lineHeight: large ? t.h1.lineHeight : t.h3.lineHeight + 4,
            fontWeight: '800',
            color: theme.colors.ink,
          }}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={1} style={{ fontSize: t.bodySm.size, lineHeight: t.bodySm.lineHeight, color: theme.colors.muted }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {actions.map((a) => (
        <View key={a.label} style={{ marginLeft: theme.spacing.xs }}>
          <IconButton icon={a.icon} onPress={a.onPress} label={a.label} variant="plain" style={{ backgroundColor: theme.colors.surface2 }} />
          {a.dot ? (
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                top: 8,
                right: 9,
                width: 9,
                height: 9,
                borderRadius: 5,
                backgroundColor: theme.colors.danger,
                borderWidth: 1.5,
                borderColor: theme.colors.bg,
              }}
            />
          ) : null}
        </View>
      ))}
      {!hideThemeToggle ? (
        <View style={{ marginLeft: theme.spacing.xs }}>
          <IconButton
            icon={mode === 'dark' ? 'sun' : 'moon'}
            onPress={toggle}
            label={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            variant="plain"
            style={{ backgroundColor: theme.colors.surface2 }}
          />
        </View>
      ) : null}
    </View>
  );
}

export function Avatar({ name, size = 44, style }: { name: string; size?: number; style?: StyleProp<ViewStyle> }) {
  const { theme } = useTheme();
  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('') || '?';
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: theme.colors.primaryTint,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      <Text style={{ fontSize: size * 0.38, fontWeight: '800', color: theme.colors.primaryOnTint }}>{initials}</Text>
    </View>
  );
}

export function Chip({
  label,
  selected = false,
  onPress,
  icon,
  style,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
}) {
  const { theme } = useTheme();
  const fg = selected ? theme.colors.bg : theme.colors.ink;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          minHeight: 36,
          paddingHorizontal: theme.spacing.md,
          borderRadius: theme.radius.sm,
          backgroundColor: selected ? theme.colors.ink : theme.colors.surface2,
          opacity: pressed ? 0.8 : 1,
        },
        style,
      ]}
    >
      {icon ? (
        <View style={{ marginRight: 6 }}>
          <Icon name={icon} size={ICON_SIZE.xs} color={fg} />
        </View>
      ) : null}
      <Text style={{ fontSize: theme.typography.bodySm.size, fontWeight: '700', color: fg }}>{label}</Text>
    </Pressable>
  );
}

/** Round, story-style shortcut (Instagram highlights). */
export function StoryAction({
  icon,
  label,
  onPress,
  highlight = false,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  highlight?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({ width: 76, alignItems: 'center', opacity: pressed ? 0.75 : 1 })}
    >
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 32,
          padding: 3,
          borderWidth: 2,
          borderColor: highlight ? theme.colors.primary : theme.colors.line,
        }}
      >
        <View
          style={{
            flex: 1,
            borderRadius: 29,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: highlight ? theme.colors.primary : theme.colors.surface2,
          }}
        >
          <Icon name={icon} size={ICON_SIZE.md} color={highlight ? theme.colors.onPrimary : theme.colors.ink} />
        </View>
      </View>
      <Text
        numberOfLines={1}
        style={{
          fontSize: theme.typography.caption.size,
          fontWeight: '600',
          color: theme.colors.ink,
          marginTop: 6,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function ProgressBar({ value, color, style }: { value: number; color?: string; style?: StyleProp<ViewStyle> }) {
  const { theme } = useTheme();
  const pct = Math.max(0, Math.min(1, value));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ now: Math.round(pct * 100), min: 0, max: 100 }}
      style={[{ height: 6, borderRadius: 3, backgroundColor: theme.colors.surface2, overflow: 'hidden' }, style]}
    >
      <View style={{ width: `${Math.round(pct * 100)}%`, height: 6, borderRadius: 3, backgroundColor: color ?? theme.colors.primary }} />
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Re-exports for convenient single-import usage                       */
/* ------------------------------------------------------------------ */

export { useTheme };
export type { Theme, ThemeMode };
export { Icon, ICON_SIZE };
export type { IconName };

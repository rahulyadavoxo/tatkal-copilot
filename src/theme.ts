/**
 * Tatkal Copilot — design system (Wave 1).
 *
 * - `C`, `BERTH_LABELS`, `GENDER_LABELS` are the LEGACY exports. They are kept
 *   byte-for-byte intact so existing screens keep working during the transition.
 * - New code should use `useTheme()` from this module and the `Theme` object.
 *
 * Brand (2026-10 redesign): one violet primary — #9B8CFF on near-black in dark
 * mode, #5B3DF5 on soft grey/white in light mode — neutrals everywhere else.
 *
 * Contrast (WCAG, computed): dark ink/bg 17.7 · muted/bg 7.8 · faint/bg 4.7 ·
 *   onPrimary/primary 7.1 · danger/bg 7.2. Light onPrimary/primary 6.1 ·
 *   primary/bg 5.6 · muted/bg 6.0 · faint/bg 3.8 (disabled only) · danger 4.8.
 */

import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Appearance } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/* ------------------------------------------------------------------ */
/* Legacy palette — DO NOT CHANGE. Existing screens import this.       */
/* ------------------------------------------------------------------ */

/** Tiny shared theme — functional styling, no design system pretensions. */
export const C = {
  bg: '#0B1210',
  card: '#141C18',
  ink: '#EAF2E4',
  muted: '#9AA79B',
  lime: '#A6E22E',
  danger: '#FF6B6B',
  line: '#243026',
  // "Speed Protocol" dashboard palette (user-supplied mockup 2026-10-02).
  // Used by the home dashboard; other screens still use the lime tokens
  // above until they are reskinned.
  primary: '#7F5AF0',
  primaryDeep: '#6A3FF0',
  violet: '#A78BFA',
  navy: '#0C1220',
  surface: '#151C2E',
  surface2: '#1B2438',
  teal: '#2DD4A8',
  faint: '#8A94A6',
};

export const BERTH_LABELS: Record<string, string> = {
  LB: 'Lower',
  MB: 'Middle',
  UB: 'Upper',
  SL: 'Side Lower',
  SU: 'Side Upper',
  WS: 'Window Side',
};

export const GENDER_LABELS: Record<string, string> = {
  M: 'Male',
  F: 'Female',
  O: 'Other',
};

/* ------------------------------------------------------------------ */
/* Design-system types                                                 */
/* ------------------------------------------------------------------ */

export type ThemeMode = 'light' | 'dark';

export interface ThemeColors {
  bg: string;
  surface: string;
  surface2: string;
  card: string;
  ink: string;
  muted: string;
  /** Disabled / placeholder text. Guaranteed ≥ 3:1 against bg. */
  faint: string;
  line: string;
  primary: string;
  primaryDeep: string;
  /** Text/icons drawn ON TOP of primary. */
  onPrimary: string;
  /** Teal accent (secondary brand). */
  accent: string;
  danger: string;
  dangerDeep: string;
  onDanger: string;
  warn: string;
  success: string;
  info: string;
  /** Brand lime — decorative brand moments, never body text in light mode. */
  lime: string;
  overlay: string;
  /* Tinted surfaces for badges / status pills */
  primaryTint: string;
  dangerTint: string;
  warnTint: string;
  successTint: string;
  infoTint: string;
  neutralTint: string;
  /* Text colors used ON the tints above (all ≥ 4.5:1 vs their tint) */
  primaryOnTint: string;
  dangerOnTint: string;
  warnOnTint: string;
  successOnTint: string;
  infoOnTint: string;
  neutralOnTint: string;
}

export interface TypeSpec {
  size: number;
  weight: '400' | '500' | '600' | '700' | '800';
  lineHeight: number;
  fontFamily?: string;
}

export interface ThemeTypography {
  display: TypeSpec;
  h1: TypeSpec;
  h2: TypeSpec;
  h3: TypeSpec;
  body: TypeSpec;
  bodySm: TypeSpec;
  caption: TypeSpec;
  /** Monospace — countdown digits, PNR, train numbers. */
  mono: TypeSpec;
}

export type SpacingScale = Record<'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'xxl' | 'xxxl', number>;
export type RadiusScale = Record<'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'full', number>;

export interface ElevationSpec {
  shadowColor: string;
  shadowOffset: { width: number; height: number };
  shadowOpacity: number;
  shadowRadius: number;
  elevation: number;
}

export type ElevationScale = Record<'none' | 'sm' | 'md' | 'lg', ElevationSpec>;

export interface MotionScale {
  instant: number;
  fast: number;
  normal: number;
  slow: number;
}

export interface Theme {
  mode: ThemeMode;
  colors: ThemeColors;
  typography: ThemeTypography;
  spacing: SpacingScale;
  radius: RadiusScale;
  elevation: ElevationScale;
  motion: MotionScale;
}

/* ------------------------------------------------------------------ */
/* Shared scales (mode-independent)                                    */
/* ------------------------------------------------------------------ */

const typography: ThemeTypography = {
  // 2026-10 redesign: bolder, tighter headings in the style of the big social
  // apps; body stays 16/24 for readability.
  display: { size: 36, weight: '800', lineHeight: 42 },
  h1: { size: 28, weight: '800', lineHeight: 34 },
  h2: { size: 22, weight: '700', lineHeight: 28 },
  h3: { size: 17, weight: '700', lineHeight: 22 },
  body: { size: 16, weight: '400', lineHeight: 24 },
  bodySm: { size: 14, weight: '400', lineHeight: 20 },
  caption: { size: 12, weight: '600', lineHeight: 16 },
  mono: { size: 15, weight: '700', lineHeight: 22, fontFamily: 'monospace' },
};

const spacing: SpacingScale = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 };
const radius: RadiusScale = { xs: 6, sm: 10, md: 14, lg: 20, xl: 28, full: 9999 };
const motion: MotionScale = { instant: 0, fast: 150, normal: 250, slow: 400 };

/* ------------------------------------------------------------------ */
/* Dark theme — deep ink-green + lime brand (evolves the legacy palette)*/
/* ------------------------------------------------------------------ */

const darkColors: ThemeColors = {
  // 2026-10 redesign: near-black canvas (Instagram / YouTube dark), one vivid
  // violet brand colour, everything else neutral.
  bg: '#0A0A0F',
  surface: '#15151C',
  surface2: '#1F1F29',
  card: '#15151C',
  ink: '#F2F2F7',
  muted: '#A1A1B5',
  faint: '#7A7A8E',
  line: '#26262F',
  primary: '#9B8CFF',
  primaryDeep: '#7B68FF',
  onPrimary: '#0A0A0F',
  accent: '#2DD4A8',
  danger: '#FF6B81',
  dangerDeep: '#F0435F',
  onDanger: '#0A0A0F',
  warn: '#FFC94D',
  success: '#34D399',
  info: '#7DB4FF',
  lime: '#A6E22E',
  overlay: 'rgba(0,0,0,0.66)',
  primaryTint: 'rgba(155,140,255,0.16)',
  dangerTint: 'rgba(255,107,129,0.14)',
  warnTint: 'rgba(255,201,77,0.14)',
  successTint: 'rgba(52,211,153,0.14)',
  infoTint: 'rgba(125,180,255,0.14)',
  neutralTint: 'rgba(161,161,181,0.14)',
  primaryOnTint: '#B9AEFF',
  dangerOnTint: '#FF8FA0',
  warnOnTint: '#FFD47E',
  successOnTint: '#6EE7B7',
  infoOnTint: '#A5CBFF',
  neutralOnTint: '#D1D1DE',
};

const darkElevation: ElevationScale = {
  none: { shadowColor: '#000', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0, shadowRadius: 0, elevation: 0 },
  sm: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.35, shadowRadius: 4, elevation: 3 },
  md: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 8, elevation: 6 },
  lg: { shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.45, shadowRadius: 16, elevation: 10 },
};

/* ------------------------------------------------------------------ */
/* Light theme — warm paper, dark ink, deep lime-green primary         */
/* ------------------------------------------------------------------ */

const lightColors: ThemeColors = {
  // 2026-10 redesign: soft grey canvas with white cards (Facebook / Instagram
  // light), deep violet brand colour.
  bg: '#F5F5F8',
  surface: '#FFFFFF',
  surface2: '#EDEDF2',
  card: '#FFFFFF',
  ink: '#0F0F14',
  muted: '#5C5C6E',
  faint: '#7C7C8C',
  line: '#E4E4EB',
  primary: '#5B3DF5',
  primaryDeep: '#4A2FD9',
  onPrimary: '#FFFFFF',
  accent: '#0D7A58',
  danger: '#D92D4A',
  dangerDeep: '#B8203B',
  onDanger: '#FFFFFF',
  warn: '#8A5A00',
  success: '#0E7A45',
  info: '#1D5FC2',
  lime: '#A6E22E',
  overlay: 'rgba(15,15,20,0.5)',
  primaryTint: '#ECE8FF',
  dangerTint: '#FCE7EB',
  warnTint: '#FBF0D6',
  successTint: '#DDF3E7',
  infoTint: '#E2ECFC',
  neutralTint: '#EDEDF2',
  primaryOnTint: '#4A2FD9',
  dangerOnTint: '#B8203B',
  warnOnTint: '#7A4F00',
  successOnTint: '#0B5E36',
  infoOnTint: '#174D9E',
  neutralOnTint: '#46465A',
};

const lightElevation: ElevationScale = {
  // Soft, diffuse shadows tinted with the brand ink.
  none: { shadowColor: '#000', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0, shadowRadius: 0, elevation: 0 },
  sm: { shadowColor: '#1A1640', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 3, elevation: 2 },
  md: { shadowColor: '#1A1640', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.1, shadowRadius: 8, elevation: 4 },
  lg: { shadowColor: '#1A1640', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.12, shadowRadius: 16, elevation: 8 },
};

export const darkTheme: Theme = {
  mode: 'dark',
  colors: darkColors,
  typography,
  spacing,
  radius,
  elevation: darkElevation,
  motion,
};

export const lightTheme: Theme = {
  mode: 'light',
  colors: lightColors,
  typography,
  spacing,
  radius,
  elevation: lightElevation,
  motion,
};

export function getTheme(mode: ThemeMode): Theme {
  return mode === 'light' ? lightTheme : darkTheme;
}

/* ------------------------------------------------------------------ */
/* ThemeProvider — module singleton, system scheme default, persisted    */
/* ------------------------------------------------------------------ */

/** Storage key for the user's explicit theme choice. */
const THEME_STORAGE_KEY = 'tatkal.theme.mode';

function systemMode(): ThemeMode {
  return Appearance.getColorScheme() === 'light' ? 'light' : 'dark';
}

let singletonMode: ThemeMode = systemMode();
let userHasChosen = false;
const subscribers = new Set<(m: ThemeMode) => void>();

function notify(): void {
  subscribers.forEach((fn) => fn(singletonMode));
}

async function saveTheme(mode: ThemeMode): Promise<void> {
  try {
    await SecureStore.setItemAsync(THEME_STORAGE_KEY, mode);
  } catch {
    // Storage is best-effort: a failed save just means the choice won't
    // survive a restart; the in-memory mode still applies.
  }
}

function writeSingleton(mode: ThemeMode, fromUser: boolean): void {
  if (fromUser) {
    userHasChosen = true;
    void saveTheme(mode);
  }
  if (singletonMode !== mode) {
    singletonMode = mode;
    notify();
  }
}

/**
 * Load the user's saved theme choice (if any) into the singleton. Call once
 * at app startup — ThemeProvider subscribers re-render when it resolves, so
 * a saved light mode survives OTA restarts instead of resetting to dark.
 */
export async function loadSavedTheme(): Promise<void> {
  try {
    const saved = await SecureStore.getItemAsync(THEME_STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') writeSingleton(saved, true);
  } catch {
    // No saved choice (or storage unavailable): keep the system default.
  }
}

function subscribe(fn: (m: ThemeMode) => void): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

// Follow the OS scheme until the user explicitly picks a mode.
Appearance.addChangeListener?.(({ colorScheme }) => {
  if (!userHasChosen) writeSingleton(colorScheme === 'light' ? 'light' : 'dark', false);
});

/** Read the current mode without React (tests / non-component code). */
export function getThemeMode(): ThemeMode {
  return singletonMode;
}

export interface ThemeContextValue {
  theme: Theme;
  mode: ThemeMode;
  isDark: boolean;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: darkTheme,
  mode: 'dark',
  isDark: true,
  setMode: () => {},
  toggle: () => {},
});

export function ThemeProvider({ children, initialMode }: { children: ReactNode; initialMode?: ThemeMode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => initialMode ?? singletonMode);

  useEffect(() => {
    if (initialMode) writeSingleton(initialMode, true);
    return subscribe(setModeState);
  }, [initialMode]);

  const setMode = useCallback((m: ThemeMode) => writeSingleton(m, true), []);
  const toggle = useCallback(() => {
    setModeState((prev) => {
      const next: ThemeMode = prev === 'light' ? 'dark' : 'light';
      writeSingleton(next, true);
      return next;
    });
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme: mode === 'light' ? lightTheme : darkTheme,
      mode,
      isDark: mode === 'dark',
      setMode,
      toggle,
    }),
    [mode, setMode, toggle],
  );

  return createElement(ThemeContext.Provider, { value }, children);
}

/**
 * Usage (Wave 2 screens):
 *
 *   import { useTheme } from '../theme';
 *   const { theme, mode, setMode, toggle, isDark } = useTheme();
 *   <View style={{ backgroundColor: theme.colors.bg, padding: theme.spacing.lg }} />
 */
export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

/**
 * Tatkal Copilot — icon set (2026-10 redesign).
 *
 * One consistent outline family: every glyph is drawn on a 24x24 grid with a
 * 2-unit stroke, round line caps and the same corner radii, so icons sit
 * together like a single typeface (Instagram / YouTube style).
 *
 * Still pure React Native Views — no react-native-svg, no text glyphs, no
 * emoji. Each icon is DATA (lines, rings, arcs, outlined rects, dots) and a
 * tiny renderer turns it into absolutely-positioned Views:
 *   L  x1 y1 x2 y2        stroke line (rotated pill = round caps)
 *   C  cx cy r            ring
 *   CF cx cy r            filled dot
 *   R  x y w h radius     outlined rounded rect
 *   A  cx cy r mask rot   arc: ring with only the sides in mask visible
 *                         (top,right,bottom,left — each side = 90°), rotated
 * Geometry is generated from tools/icons/icons_spec.py, which also renders
 * the preview sheet; edit the spec, re-run the generator, never hand-tune here.
 *
 * API unchanged: <Icon name size color accessibilityLabel style />,
 * IconName, ICON_SIZE. Colour defaults to theme ink.
 */
import React from 'react';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { useTheme } from '../theme';

export type IconName =
  | 'home'
  | 'ticket'
  | 'train'
  | 'users'
  | 'bell'
  | 'shield'
  | 'settings'
  | 'search'
  | 'plus'
  | 'minus'
  | 'x'
  | 'check'
  | 'chevronRight'
  | 'chevronLeft'
  | 'chevronDown'
  | 'arrowLeft'
  | 'arrowRight'
  | 'clock'
  | 'calendar'
  | 'mapPin'
  | 'eye'
  | 'eyeOff'
  | 'trash'
  | 'edit'
  | 'alertTriangle'
  | 'info'
  | 'helpCircle'
  | 'wifiOff'
  | 'history'
  | 'refresh'
  | 'card'
  | 'logout'
  | 'moon'
  | 'sun'
  | 'lock'
  | 'externalLink';

export interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Standardized icon sizes (dp). Call sites must use these tokens.
 * - xs (16) checklist ticks, inline meta, badges
 * - sm (20) buttons, list rows, chevrons
 * - md (24) tab bar, default
 * - lg (28) card leading icons, feature headers
 * - xl (32) empty states
 * - hero (48) icons inside dedicated circular containers
 */
export const ICON_SIZE = {
  xs: 16,
  sm: 20,
  md: 24,
  lg: 28,
  xl: 32,
  hero: 48,
} as const;

/** Stroke width on the 24-unit grid. */
const SW = 2.0;

type Prim =
  | ['L', number, number, number, number]
  | ['C', number, number, number]
  | ['CF', number, number, number]
  | ['R', number, number, number, number, number]
  | ['A', number, number, number, string, number];

const ICONS: Record<IconName, Prim[]> = {
  home: [['L', 3, 11, 12, 3.5], ['L', 12, 3.5, 21, 11], ['L', 5, 9.5, 5, 20], ['L', 19, 9.5, 19, 20], ['L', 5, 20, 19, 20], ['L', 9.75, 20, 9.75, 14.5], ['L', 14.25, 20, 14.25, 14.5], ['L', 9.75, 14.5, 14.25, 14.5]],
  ticket: [['R', 3, 6, 18, 12, 3], ['L', 15, 8.5, 15, 9], ['L', 15, 11.75, 15, 12.25], ['L', 15, 15, 15, 15.5]],
  train: [['R', 5, 3, 14, 14, 4], ['L', 5, 10, 19, 10], ['CF', 9, 13.5, 1.25], ['CF', 15, 13.5, 1.25], ['L', 8.5, 17.5, 6.5, 21], ['L', 15.5, 17.5, 17.5, 21], ['L', 10, 6.5, 14, 6.5]],
  users: [['C', 17, 6.5, 2.5], ['A', 17, 17.5, 4.5, '1001', 45], ['C', 8.5, 9.5, 3.5], ['A', 8.5, 20.5, 6, '1001', 45]],
  bell: [['A', 12, 10, 6, '1001', 45], ['L', 6, 10, 6, 16.5], ['L', 18, 10, 18, 16.5], ['L', 4, 17, 20, 17], ['L', 10, 20.5, 14, 20.5]],
  shield: [['L', 4.5, 5.5, 12, 2.75], ['L', 12, 2.75, 19.5, 5.5], ['L', 4.5, 5.5, 4.5, 11.5], ['L', 19.5, 5.5, 19.5, 11.5], ['L', 4.5, 11.5, 12, 21.25], ['L', 19.5, 11.5, 12, 21.25]],
  settings: [['C', 12, 12, 7], ['CF', 12, 12, 2.5], ['L', 12, 5, 12, 2.5], ['L', 16.95, 7.05, 18.72, 5.28], ['L', 19, 12, 21.5, 12], ['L', 16.95, 16.95, 18.72, 18.72], ['L', 12, 19, 12, 21.5], ['L', 7.05, 16.95, 5.28, 18.72], ['L', 5, 12, 2.5, 12], ['L', 7.05, 7.05, 5.28, 5.28]],
  search: [['C', 11, 11, 6.5], ['L', 16, 16, 20.5, 20.5]],
  plus: [['L', 12, 5, 12, 19], ['L', 5, 12, 19, 12]],
  minus: [['L', 5, 12, 19, 12]],
  x: [['L', 6, 6, 18, 18], ['L', 18, 6, 6, 18]],
  check: [['L', 5, 12.5, 9.5, 17], ['L', 9.5, 17, 19, 7]],
  chevronRight: [['L', 9, 6, 15, 12], ['L', 15, 12, 9, 18]],
  chevronLeft: [['L', 15, 6, 9, 12], ['L', 9, 12, 15, 18]],
  chevronDown: [['L', 6, 9, 12, 15], ['L', 12, 15, 18, 9]],
  arrowLeft: [['L', 5, 12, 19, 12], ['L', 5, 12, 11, 6], ['L', 5, 12, 11, 18]],
  arrowRight: [['L', 5, 12, 19, 12], ['L', 19, 12, 13, 6], ['L', 19, 12, 13, 18]],
  clock: [['C', 12, 12, 9], ['L', 12, 7, 12, 12], ['L', 12, 12, 15.5, 14]],
  calendar: [['R', 3.5, 5, 17, 16, 3], ['L', 3.5, 10, 20.5, 10], ['L', 8, 3, 8, 7], ['L', 16, 3, 16, 7]],
  mapPin: [['A', 12, 9.5, 7, '1101', 0], ['L', 16.95, 14.45, 12, 21.5], ['L', 7.05, 14.45, 12, 21.5], ['C', 12, 9.5, 2.5]],
  eye: [['A', 12, 19.4, 10.5, '1000', 0], ['A', 12, 4.6, 10.5, '0010', 0], ['C', 12, 12, 3]],
  eyeOff: [['A', 12, 19.4, 10.5, '1000', 0], ['A', 12, 4.6, 10.5, '0010', 0], ['C', 12, 12, 3], ['L', 4, 4, 20, 20]],
  trash: [['L', 4, 6.5, 20, 6.5], ['L', 9.5, 6.5, 9.5, 3.5], ['L', 9.5, 3.5, 14.5, 3.5], ['L', 14.5, 3.5, 14.5, 6.5], ['L', 6, 6.5, 7, 20.5], ['L', 18, 6.5, 17, 20.5], ['L', 7, 20.5, 17, 20.5], ['L', 10, 10.5, 10, 16.5], ['L', 14, 10.5, 14, 16.5]],
  edit: [['L', 16.5, 4.5, 19.5, 7.5], ['L', 16.5, 4.5, 6, 15], ['L', 19.5, 7.5, 9, 18], ['L', 6, 15, 4.5, 19.5], ['L', 9, 18, 4.5, 19.5], ['L', 14, 7, 17, 10]],
  alertTriangle: [['L', 12, 3.5, 21.5, 20], ['L', 21.5, 20, 2.5, 20], ['L', 2.5, 20, 12, 3.5], ['L', 12, 9.5, 12, 13.5], ['CF', 12, 16.75, 1.25]],
  info: [['C', 12, 12, 9], ['L', 12, 11, 12, 16.5], ['CF', 12, 7.75, 1.25]],
  helpCircle: [['C', 12, 12, 9], ['A', 12, 9.5, 2.75, '1100', -20], ['L', 14.49, 10.66, 12, 12.5], ['L', 12, 12.5, 12, 13.5], ['CF', 12, 16.75, 1.25]],
  wifiOff: [['A', 12, 19, 4.5, '1000', 0], ['A', 12, 19, 9, '1000', 0], ['A', 12, 19, 13.5, '1000', 0], ['CF', 12, 19, 1.25], ['L', 4, 4, 20, 20]],
  history: [['A', 12, 12, 9, '0111', -25], ['L', 3.54, 8.92, 3.54, 4.4], ['L', 3.54, 8.92, 8, 8.92], ['L', 12, 7.5, 12, 12], ['L', 12, 12, 15, 14]],
  refresh: [['A', 12, 12, 9, '0111', 25], ['L', 20.46, 8.92, 20.46, 4.4], ['L', 20.46, 8.92, 16, 8.92]],
  card: [['R', 2.5, 5, 19, 14, 3], ['L', 2.5, 10, 21.5, 10], ['L', 6, 15, 9, 15]],
  logout: [['L', 10, 4, 5, 4], ['L', 5, 4, 5, 20], ['L', 5, 20, 10, 20], ['L', 10, 12, 20, 12], ['L', 20, 12, 16, 8], ['L', 20, 12, 16, 16]],
  moon: [['A', 12, 12, 8, '1011', 0]],
  sun: [['C', 12, 12, 4], ['L', 19, 12, 21.5, 12], ['L', 16.95, 16.95, 18.72, 18.72], ['L', 12, 19, 12, 21.5], ['L', 7.05, 16.95, 5.28, 18.72], ['L', 5, 12, 2.5, 12], ['L', 7.05, 7.05, 5.28, 5.28], ['L', 12, 5, 12, 2.5], ['L', 16.95, 7.05, 18.72, 5.28]],
  lock: [['R', 5, 11, 14, 10, 2.5], ['A', 12, 8, 4, '1001', 45], ['L', 8, 8, 8, 11], ['L', 16, 8, 16, 11], ['L', 12, 15, 12, 17]],
  externalLink: [['L', 10, 6, 5, 6], ['L', 5, 6, 5, 19], ['L', 5, 19, 18, 19], ['L', 18, 19, 18, 14], ['L', 14, 4, 20, 4], ['L', 20, 4, 20, 10], ['L', 20, 4, 11, 13]],
};

function renderLine(x1: number, y1: number, x2: number, y2: number, color: string, key: string | number) {
  const len = Math.hypot(x2 - x1, y2 - y1) + SW;
  const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  return (
    <View
      key={key}
      style={{
        position: 'absolute',
        left: (x1 + x2) / 2 - len / 2,
        top: (y1 + y2) / 2 - SW / 2,
        width: len,
        height: SW,
        borderRadius: SW / 2,
        backgroundColor: color,
        transform: [{ rotate: `${angle}deg` }],
      }}
    />
  );
}

function renderPrim(p: Prim, color: string, key: number) {
  switch (p[0]) {
    case 'L': {
      const [, x1, y1, x2, y2] = p;
      return renderLine(x1, y1, x2, y2, color, key);
    }
    case 'C':
    case 'CF': {
      const [kind, cx, cy, r] = p;
      const filled = kind === 'CF';
      const d = filled ? r * 2 : r * 2 + SW;
      return (
        <View
          key={key}
          style={{
            position: 'absolute',
            left: cx - d / 2,
            top: cy - d / 2,
            width: d,
            height: d,
            borderRadius: d / 2,
            ...(filled ? { backgroundColor: color } : { borderWidth: SW, borderColor: color }),
          }}
        />
      );
    }
    case 'R': {
      const [, x, y, w, h, rad] = p;
      return (
        <View
          key={key}
          style={{
            position: 'absolute',
            left: x - SW / 2,
            top: y - SW / 2,
            width: w + SW,
            height: h + SW,
            borderRadius: rad + SW / 2,
            borderWidth: SW,
            borderColor: color,
          }}
        />
      );
    }
    case 'A': {
      // Arcs are drawn as short round-capped segments: per-side border
      // colors on a rounded View do not render on-device, plain lines do.
      // mask picks 90° sides as 'top,right,bottom,left' bits; 0° is 12
      // o'clock, angles grow clockwise, then everything rotates by `rot`.
      const [, cx, cy, r, mask, rotDeg] = p;
      const rot = (rotDeg * Math.PI) / 180;
      const segs: ReactNode[] = [];
      const STEPS = 9; // ~10° per segment: smooth at a 2-unit stroke
      for (let s = 0; s < 4; s++) {
        if (mask[s] !== '1') continue;
        const center = rot + (s * Math.PI) / 2;
        for (let i = 0; i < STEPS; i++) {
          const a1 = center - Math.PI / 4 + ((i * Math.PI) / 2 / STEPS);
          const a2 = center - Math.PI / 4 + (((i + 1) * Math.PI) / 2 / STEPS);
          segs.push(
            renderLine(
              cx + r * Math.sin(a1),
              cy - r * Math.cos(a1),
              cx + r * Math.sin(a2),
              cy - r * Math.cos(a2),
              color,
              `a${key}-${segs.length}`,
            ),
          );
        }
      }
      return <>{segs}</>;
    }
    default:
      return null;
  }
}

/**
 * The icon set. `color` defaults to the theme's ink so icons work inline
 * without extra props. `size` should be one of ICON_SIZE.
 */
export function Icon({ name, size = 24, color, accessibilityLabel, style }: IconProps) {
  const { theme } = useTheme();
  const resolved = color ?? theme.colors.ink;
  const prims = ICONS[name] ?? [];
  const offset = (size - 24) / 2;
  return (
    <View
      accessible={!!accessibilityLabel}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="image"
      importantForAccessibility={accessibilityLabel ? 'yes' : 'no-hide-descendants'}
      style={[{ width: size, height: size }, style]}
    >
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: offset,
          top: offset,
          width: 24,
          height: 24,
          transform: [{ scale: size / 24 }],
        }}
      >
        {prims.map((p, i) => renderPrim(p, resolved, i))}
      </View>
    </View>
  );
}

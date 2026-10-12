import json, icons_spec as S
names=list(S.ICONS)
def fmt(v): 
    return ('%g'%v)
def prim(p):
    k=p[0]
    if k=='A':
        _,cx,cy,r,sides,rot=p
        mask=''.join('1' if s in sides else '0' for s in ('top','right','bottom','left'))
        return f"['A', {fmt(cx)}, {fmt(cy)}, {fmt(r)}, '{mask}', {fmt(rot)}]"
    return '['+', '.join([f"'{k}'"]+[fmt(x) for x in p[1:]])+']'
data='\n'.join(f"  {n}: [{', '.join(prim(p) for p in S.ICONS[n])}]," for n in names)
union='\n'.join(f"  | '{n}'" for n in names)
ts=f'''/**
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
import type {{ ReactNode }} from 'react';
import {{ View }} from 'react-native';
import type {{ StyleProp, ViewStyle }} from 'react-native';
import {{ useTheme }} from '../theme';

export type IconName =
{union};

export interface IconProps {{
  name: IconName;
  size?: number;
  color?: string;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}}

/**
 * Standardized icon sizes (dp). Call sites must use these tokens.
 * - xs (16) checklist ticks, inline meta, badges
 * - sm (20) buttons, list rows, chevrons
 * - md (24) tab bar, default
 * - lg (28) card leading icons, feature headers
 * - xl (32) empty states
 * - hero (48) icons inside dedicated circular containers
 */
export const ICON_SIZE = {{
  xs: 16,
  sm: 20,
  md: 24,
  lg: 28,
  xl: 32,
  hero: 48,
}} as const;

/** Stroke width on the 24-unit grid. */
const SW = {S.SW};

type Prim =
  | ['L', number, number, number, number]
  | ['C', number, number, number]
  | ['CF', number, number, number]
  | ['R', number, number, number, number, number]
  | ['A', number, number, number, string, number];

const ICONS: Record<IconName, Prim[]> = {{
{data}
}};

function renderLine(x1: number, y1: number, x2: number, y2: number, color: string, key: string | number) {{
  const len = Math.hypot(x2 - x1, y2 - y1) + SW;
  const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  return (
    <View
      key={{key}}
      style={{{{
        position: 'absolute',
        left: (x1 + x2) / 2 - len / 2,
        top: (y1 + y2) / 2 - SW / 2,
        width: len,
        height: SW,
        borderRadius: SW / 2,
        backgroundColor: color,
        transform: [{{ rotate: `${{angle}}deg` }}],
      }}}}
    />
  );
}}

function renderPrim(p: Prim, color: string, key: number) {{
  switch (p[0]) {{
    case 'L': {{
      const [, x1, y1, x2, y2] = p;
      return renderLine(x1, y1, x2, y2, color, key);
    }}
    case 'C':
    case 'CF': {{
      const [kind, cx, cy, r] = p;
      const filled = kind === 'CF';
      const d = filled ? r * 2 : r * 2 + SW;
      return (
        <View
          key={{key}}
          style={{{{
            position: 'absolute',
            left: cx - d / 2,
            top: cy - d / 2,
            width: d,
            height: d,
            borderRadius: d / 2,
            ...(filled ? {{ backgroundColor: color }} : {{ borderWidth: SW, borderColor: color }}),
          }}}}
        />
      );
    }}
    case 'R': {{
      const [, x, y, w, h, rad] = p;
      return (
        <View
          key={{key}}
          style={{{{
            position: 'absolute',
            left: x - SW / 2,
            top: y - SW / 2,
            width: w + SW,
            height: h + SW,
            borderRadius: rad + SW / 2,
            borderWidth: SW,
            borderColor: color,
          }}}}
        />
      );
    }}
    case 'A': {{
      // Arcs are drawn as short round-capped segments: per-side border
      // colors on a rounded View do not render on-device, plain lines do.
      // mask picks 90° sides as 'top,right,bottom,left' bits; 0° is 12
      // o'clock, angles grow clockwise, then everything rotates by `rot`.
      const [, cx, cy, r, mask, rotDeg] = p;
      const rot = (rotDeg * Math.PI) / 180;
      const segs: ReactNode[] = [];
      const STEPS = 9; // ~10° per segment: smooth at a 2-unit stroke
      for (let s = 0; s < 4; s++) {{
        if (mask[s] !== '1') continue;
        const center = rot + (s * Math.PI) / 2;
        for (let i = 0; i < STEPS; i++) {{
          const a1 = center - Math.PI / 4 + ((i * Math.PI) / 2 / STEPS);
          const a2 = center - Math.PI / 4 + (((i + 1) * Math.PI) / 2 / STEPS);
          segs.push(
            renderLine(
              cx + r * Math.sin(a1),
              cy - r * Math.cos(a1),
              cx + r * Math.sin(a2),
              cy - r * Math.cos(a2),
              color,
              `a${{key}}-${{segs.length}}`,
            ),
          );
        }}
      }}
      return <>{{segs}}</>;
    }}
    default:
      return null;
  }}
}}

/**
 * The icon set. `color` defaults to the theme's ink so icons work inline
 * without extra props. `size` should be one of ICON_SIZE.
 */
export function Icon({{ name, size = 24, color, accessibilityLabel, style }}: IconProps) {{
  const {{ theme }} = useTheme();
  const resolved = color ?? theme.colors.ink;
  const prims = ICONS[name] ?? [];
  const offset = (size - 24) / 2;
  return (
    <View
      accessible={{!!accessibilityLabel}}
      accessibilityLabel={{accessibilityLabel}}
      accessibilityRole="image"
      importantForAccessibility={{accessibilityLabel ? 'yes' : 'no-hide-descendants'}}
      style={{[{{ width: size, height: size }}, style]}}
    >
      <View
        pointerEvents="none"
        style={{{{
          position: 'absolute',
          left: offset,
          top: offset,
          width: 24,
          height: 24,
          transform: [{{ scale: size / 24 }}],
        }}}}
      >
        {{prims.map((p, i) => renderPrim(p, resolved, i))}}
      </View>
    </View>
  );
}}
'''
open(__import__('os').path.join(__import__('os').path.dirname(__file__),'../../src/components/icons.tsx'),'w').write(ts)

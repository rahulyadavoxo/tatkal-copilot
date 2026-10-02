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

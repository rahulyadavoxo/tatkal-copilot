/**
 * App-wide Tatkal window config.
 *
 * Thin adapter: rule numbers live ONLY in src/core/tatkalConfig.ts (L1).
 * If IRCTC changes the rules, that file changes and this follows.
 */
import {
  AC_OPEN_HOUR_IST,
  NONAC_OPEN_HOUR_IST,
  TATKAL_OPEN_DAYS_BEFORE,
} from './core/tatkalConfig';
import type { TatkalConfig } from './core/timing';

export const TATKAL_TIMING: TatkalConfig = {
  openDaysBefore: TATKAL_OPEN_DAYS_BEFORE,
  acOpenHourIST: AC_OPEN_HOUR_IST,
  nonAcOpenHourIST: NONAC_OPEN_HOUR_IST,
};

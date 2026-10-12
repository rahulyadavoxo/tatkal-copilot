/**
 * Shared stage-choice logic: the values both booking paths use, plus drift
 * guards proving the WebView engines embed exactly these values.
 */
import {
  berthOptionText,
  classDropdownWanted,
  COBRAND_SECTION_MARKERS,
  dropdownDisplayMatches,
  genderOptionText,
  insuranceOptionText,
  isStationMismatchText,
  KNOWN_CLASS_CODES,
  languageButtonText,
  paymentMethodPattern,
  paymentModeTokens,
  providerApplies,
  QUOTA_VALUE_TEXTS,
  tatkalOpenAtMs,
} from '../stageChoices';
import { buildPostSearchScript } from '../postSearchEngine';
import { buildReviewScript } from '../reviewEngine';
import { buildPaymentScript } from '../paymentEngine';
import { buildPrebookScript } from '../prebookEngine';
import { buildFieldActions, genderOptionText as fillGender } from '../fillEngine';

describe('stage choices', () => {
  it('language buttons', () => {
    expect(languageButtonText('en')).toBe('English');
    expect(languageButtonText('hi')).toBe('हिंदी');
  });

  it('class dropdown falls back to All Classes', () => {
    expect(classDropdownWanted('3A')).toEqual(['3A', 'All Classes']);
    expect(classDropdownWanted('All Classes')).toEqual(['All Classes']);
  });

  it('dropdown display match is exact or (code), never substring', () => {
    expect(dropdownDisplayMatches('AC 3 Tier (3A)', '3A')).toBe(true);
    expect(dropdownDisplayMatches('TATKAL', 'TATKAL')).toBe(true);
    expect(dropdownDisplayMatches('PREMIUM TATKAL', 'TATKAL')).toBe(false);
  });

  it('station-mismatch popup only', () => {
    expect(
      isStationMismatchText('You searched trains from DTO to NDLS but booking from DTO to ANVT. Do you want to continue with it?'),
    ).toBe(true);
    expect(isStationMismatchText('Your session is about to expire. Do you want to continue?')).toBe(false);
  });

  it('passenger option text', () => {
    expect(genderOptionText('F')).toEqual(['Female']);
    expect(genderOptionText('O')).toEqual(['Other', 'Transgender']);
    expect(berthOptionText('SL')).toEqual(['Side Lower']);
    expect(berthOptionText('??')).toEqual(['No Preference']);
    expect(insuranceOptionText(true)).toEqual(['Yes, and I accept']);
    expect(insuranceOptionText(false)).toEqual(["No, I don't want"]);
  });

  it('payment choices', () => {
    expect(paymentModeTokens('default')).toBeNull();
    expect(paymentModeTokens('bhim')).toEqual(['bhim', 'upi']);
    expect(paymentMethodPattern('default')).toBeNull();
    expect(new RegExp(paymentMethodPattern('ipay') as string).test('irctc ipay (credit card)')).toBe(true);
    expect(providerApplies('multiple', 'phonepe')).toBe(true);
    expect(providerApplies('ipay', 'phonepe')).toBe(false);
    expect(providerApplies('multiple', 'default')).toBe(false);
  });

  it('tatkal open instant matches the countdown rule', () => {
    // Journey 2026-10-02, AC -> 2026-10-01 10:00 IST = 04:30 UTC.
    const t = tatkalOpenAtMs({ quota: 'TATKAL', journeyDate: '2026-10-02', classCode: '3A', isAC: true });
    expect(new Date(t as number).toISOString()).toBe('2026-10-01T04:30:00.000Z');
    const sl = tatkalOpenAtMs({ quota: 'TATKAL', journeyDate: '2026-10-02', classCode: 'SL', isAC: false });
    expect(new Date(sl as number).toISOString()).toBe('2026-10-01T05:30:00.000Z');
    expect(tatkalOpenAtMs({ quota: 'GENERAL', journeyDate: '2026-10-02', classCode: '3A' })).toBeNull();
  });
});

describe('drift guards: WebView engines embed the shared values', () => {
  it('fill engine uses the shared option text', () => {
    expect(fillGender).toBe(genderOptionText);
    const acts = buildFieldActions({
      trainNo: '12951', from: 'NDLS', to: 'BCT', dateISO: '2026-10-11', classCode: '3A',
      quota: 'TATKAL', autoUpgradation: false, contactMobile: '9', travelInsurance: false,
      passengers: [{ name: 'A', age: 30, gender: 'M', berthPref: 'SL' }],
    });
    expect(acts.find((a) => a.label === 'travel-insurance')?.optionText).toEqual(insuranceOptionText(false));
    expect(acts.find((a) => a.label === 'pax0.berth')?.optionText).toEqual(berthOptionText('SL'));
  });

  it('post-search engine embeds classes and mismatch markers', () => {
    const s = buildPostSearchScript({ trainNo: '12951', classCode: '3A', dateISO: '2026-10-11', dateCard: '11 Oct' }, { seed: 1 });
    expect(s).toContain(JSON.stringify(KNOWN_CLASS_CODES));
    expect(s).toContain('"booking from","searched trains","boarding"');
  });

  it('review engine embeds the co-brand markers and mode tokens', () => {
    const s = buildReviewScript({ paymentMode: 'bhim' }, { seed: 1 });
    expect(s).toContain(JSON.stringify(COBRAND_SECTION_MARKERS));
    expect(s).toContain(JSON.stringify(paymentModeTokens('bhim')));
  });

  it('payment engine embeds the method patterns', () => {
    const s = buildPaymentScript({ paymentMethod: 'ipay', paymentProvider: 'default' }, { seed: 1 });
    expect(s).toContain(JSON.stringify(paymentMethodPattern('ipay')));
  });

  it('prebook engine embeds quota values and language labels', () => {
    const s = buildPrebookScript({
      language: 'hi', username: 'u', password: 'p',
      from: { code: 'NDLS', name: 'New Delhi' }, to: { code: 'BCT', name: 'Mumbai Central' },
      dateDMY: '11/10/2026', classCode: '3A', quota: 'TATKAL',
    }, { seed: 1 });
    expect(s).toContain(JSON.stringify(QUOTA_VALUE_TEXTS));
    expect(s).toContain('हिंदी');
  });
});

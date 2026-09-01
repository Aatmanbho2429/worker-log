import { describe, expect, it } from 'vitest';

import {
  confirmProblem,
  emailProblem,
  formatPhone,
  nameProblem,
  normalizePhone,
  passwordProblem,
  passwordScore,
  passwordScoreKey,
  phoneProblem,
  shortDeviceId,
} from './auth';

/**
 * The rules the register form and the profile share. They are tested here
 * rather than through either screen, because a rule that disagrees with itself
 * across the two is the failure worth catching.
 *
 * The validators return translation keys rather than sentences, so these assert
 * on keys. That is deliberate: the copy can be reworded in `en.json` without
 * touching a test, and a test can still tell one refusal from another.
 */
describe('phone', () => {
  it('strips whatever is typed around the ten digits', () => {
    for (const typed of [
      '9876543210',
      '+91 9876543210',
      '+91-98765-43210',
      '98765 43210',
      '09876543210',
      '(+91) 98765 43210',
    ]) {
      expect(normalizePhone(typed)).toBe('9876543210');
    }
  });

  it('accepts every Indian mobile prefix', () => {
    for (const first of ['6', '7', '8', '9']) {
      expect(phoneProblem(`${first}876543210`)).toBeNull();
    }
  });

  it('rejects a number that is not an Indian mobile', () => {
    // Landline prefix, too short, too long, and letters.
    expect(phoneProblem('2234567890')).toBe('validation.phonePrefix');
    expect(phoneProblem('98765')).toBe('validation.phoneLength');
    expect(phoneProblem('98765432101')).toBe('validation.phoneLength');
    expect(phoneProblem('not a number')).toBe('validation.phoneLength');
    expect(phoneProblem('')).toBe('validation.phoneRequired');
  });

  it('groups the digits for reading back', () => {
    expect(formatPhone('+919876543210')).toBe('98765 43210');
  });
});

describe('email', () => {
  it('accepts an ordinary address', () => {
    expect(emailProblem('aatman@example.com')).toBeNull();
    expect(emailProblem('  aatman.b+log@works.co.in ')).toBeNull();
  });

  it('rejects what is not one', () => {
    expect(emailProblem('')).toBe('validation.emailRequired');
    expect(emailProblem('aatman')).not.toBeNull();
    expect(emailProblem('aatman@example')).not.toBeNull();
    expect(emailProblem('aatman @example.com')).not.toBeNull();
  });
});

describe('password', () => {
  it('wants eight characters with a letter and a number', () => {
    expect(passwordProblem('Ceramic1')).toBeNull();
    expect(passwordProblem('')).toBe('validation.passwordRequired');
    expect(passwordProblem('Cer1')).toBe('validation.passwordLength');
    expect(passwordProblem('ceramicware')).toBe('validation.passwordVariety');
    expect(passwordProblem('12345678')).toBe('validation.passwordVariety');
  });

  it('scores length and variety, and stops at four', () => {
    expect(passwordScore('')).toBe(0);
    expect(passwordScore('short')).toBe(0);
    expect(passwordScore('Ceramic1')).toBe(2);
    expect(passwordScore('CeramicWaste1')).toBe(3);
    expect(passwordScore('CeramicWaste1!')).toBe(4);
  });

  it('holds the confirmation to an exact match', () => {
    expect(confirmProblem('Ceramic1', 'Ceramic1')).toBeNull();
    expect(confirmProblem('Ceramic1', '')).toBe('validation.confirmRequired');
    expect(confirmProblem('Ceramic1', 'ceramic1')).toBe('validation.confirmMismatch');
  });

  it('names the score for the meter', () => {
    expect(passwordScoreKey(0)).toBe('');
    expect(passwordScoreKey(2)).toBe('passwordStrength.fair');
    expect(passwordScoreKey(4)).toBe('passwordStrength.strong');
  });
});

describe('names', () => {
  it('reports the field it was given', () => {
    expect(nameProblem('Aatman', 'firstName')).toBeNull();
    expect(nameProblem('', 'firstName')).toBe('validation.firstNameRequired');
    expect(nameProblem('A', 'firstName')).toBe('validation.firstNameTooShort');
    expect(nameProblem('', 'lastName')).toBe('validation.lastNameRequired');
    expect(nameProblem('B', 'lastName')).toBe('validation.lastNameTooShort');
  });
});

describe('shortDeviceId', () => {
  it('keeps both ends of a long fingerprint', () => {
    expect(shortDeviceId('dev-bc6e69ad-efc5-4fc9-9d5b-477378b033dc')).toBe('dev-bc6e…33dc');
  });

  it('leaves a short one alone', () => {
    expect(shortDeviceId('dev-1234')).toBe('dev-1234');
  });
});

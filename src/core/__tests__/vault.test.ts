import { createVault } from '../vault';
import { randomBytes } from '@noble/ciphers/utils.js';

const keyOf = (seed: number) => {
  const k = new Uint8Array(32);
  for (let i = 0; i < 32; i++) k[i] = (seed + i * 7) & 255;
  return k;
};

describe('vault (G3)', () => {
  test('roundtrip preserves passenger data', async () => {
    const vault = createVault({ getKey: async () => keyOf(1) });
    const pax = [{ name: 'Asha Yadav', age: 34, gender: 'F', berthPref: 'LB' }];
    const env = await vault.encryptJSON(pax);
    expect(await vault.decryptJSON(env)).toEqual(pax);
  });

  test('ciphertext reveals nothing of the plaintext', async () => {
    const vault = createVault({ getKey: async () => keyOf(2) });
    const env = await vault.encryptJSON({ name: 'Asha Yadav' });
    expect(env).not.toContain('Asha');
    expect(env.startsWith('v1.')).toBe(true);
  });

  test('same plaintext encrypts differently each time (random nonce)', async () => {
    const vault = createVault({ getKey: async () => keyOf(3) });
    const a = await vault.encryptJSON({ x: 1 });
    const b = await vault.encryptJSON({ x: 1 });
    expect(a).not.toBe(b);
  });

  test('wrong key fails to decrypt', async () => {
    const v1 = createVault({ getKey: async () => keyOf(4) });
    const v2 = createVault({ getKey: async () => keyOf(5) });
    const env = await v1.encryptJSON({ secret: true });
    await expect(v2.decryptJSON(env)).rejects.toThrow();
  });

  test('tampered envelope fails to decrypt', async () => {
    const vault = createVault({ getKey: async () => keyOf(6) });
    const env = await vault.encryptJSON({ secret: true });
    const tampered = env.slice(0, -4) + 'AAAA';
    await expect(vault.decryptJSON(tampered)).rejects.toThrow();
  });

  test('malformed envelope rejected', async () => {
    const vault = createVault({ getKey: async () => keyOf(7) });
    await expect(vault.decryptJSON('not-an-envelope')).rejects.toThrow('malformed');
  });

  test('non-32-byte key rejected', async () => {
    const vault = createVault({ getKey: async () => randomBytes(16) });
    await expect(vault.encryptJSON({})).rejects.toThrow('32-byte');
  });

  test('injected RNG is used for the nonce (on-device expo-crypto path)', async () => {
    // On Hermes, noble's randomBytes throws (no crypto.getRandomValues), so
    // the app injects expo-crypto's native RNG. Prove the injection point.
    const fixed = new Uint8Array(12).fill(9);
    const seen: number[] = [];
    const rng = async (n: number) => {
      seen.push(n);
      return fixed;
    };
    const vault = createVault({ getKey: async () => keyOf(8) }, rng);
    const env = await vault.encryptJSON({ x: 1 });
    expect(seen).toEqual([12]);
    const nonceBytes = Buffer.from(env.split('.')[1], 'base64');
    expect(Array.from(nonceBytes)).toEqual(Array(12).fill(9));
    expect(await vault.decryptJSON(env)).toEqual({ x: 1 });
  });

  describe('slot binding / AAD (audit #29)', () => {
    test('slot-bound roundtrip works and envelope format is unchanged', async () => {
      const vault = createVault({ getKey: async () => keyOf(11) }, undefined, 'tatkal-passengers-v1');
      const env = await vault.encryptJSON({ name: 'Asha Yadav' });
      expect(env.startsWith('v1.')).toBe(true);
      expect(env.split('.')).toHaveLength(3);
      expect(await vault.decryptJSON(env)).toEqual({ name: 'Asha Yadav' });
    });

    test('envelope transplanted to another slot fails authentication', async () => {
      const vA = createVault({ getKey: async () => keyOf(12) }, undefined, 'slot-a');
      const vB = createVault({ getKey: async () => keyOf(12) }, undefined, 'slot-b');
      const env = await vA.encryptJSON({ secret: true });
      await expect(vB.decryptJSON(env)).rejects.toThrow();
    });

    test('legacy (pre-AAD) envelope decrypts with upgrade flag, then re-encrypts bound', async () => {
      const key = { getKey: async () => keyOf(13) };
      const legacy = createVault(key); // no slot = legacy behavior
      const env = await legacy.encryptJSON({ name: 'Asha Yadav' });

      const bound = createVault(key, undefined, 'tatkal-trips-v1');
      const first = await bound.decryptJSONWithUpgrade(env);
      expect(first.value).toEqual({ name: 'Asha Yadav' });
      expect(first.upgraded).toBe(true);

      // Self-healing: re-encrypt and the bound vault reads it back cleanly.
      const rewritten = await bound.encryptJSON(first.value);
      const second = await bound.decryptJSONWithUpgrade(rewritten);
      expect(second.value).toEqual({ name: 'Asha Yadav' });
      expect(second.upgraded).toBe(false);
    });

    test('tampered slot-bound envelope still throws (no downgrade bypass)', async () => {
      const vault = createVault({ getKey: async () => keyOf(14) }, undefined, 'tatkal-pnrs-v1');
      const env = await vault.encryptJSON({ secret: true });
      const tampered = env.slice(0, -4) + 'AAAA';
      await expect(vault.decryptJSON(tampered)).rejects.toThrow();
    });

    test('wrong key fails even on the legacy fallback path', async () => {
      const v1 = createVault({ getKey: async () => keyOf(15) });
      const v2 = createVault({ getKey: async () => keyOf(16) }, undefined, 'slot-x');
      const env = await v1.encryptJSON({ secret: true });
      await expect(v2.decryptJSON(env)).rejects.toThrow();
    });
  });

  describe('base64 validation (audit #33)', () => {
    test('non-multiple-of-4 envelope segment rejected with a clear error', async () => {
      const vault = createVault({ getKey: async () => keyOf(17) });
      await expect(vault.decryptJSON('v1.AAA.QUJD')).rejects.toThrow('malformed envelope');
    });

    test('envelope version tag still enforced', async () => {
      const vault = createVault({ getKey: async () => keyOf(18) });
      await expect(vault.decryptJSON('v2.QUJD.QUJD')).rejects.toThrow('malformed envelope');
    });
  });
});

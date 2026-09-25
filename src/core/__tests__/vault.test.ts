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
});

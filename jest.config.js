module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  // @noble/ciphers v2 is ESM-only (correct for Metro/RN); jest needs to transpile it.
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
    '^.+\\.jsx?$': ['ts-jest', { tsconfig: { allowJs: true, esModuleInterop: true } }],
  },
  transformIgnorePatterns: ['/node_modules/(?!@noble/ciphers)'],
};

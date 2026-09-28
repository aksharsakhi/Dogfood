module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/apps/api/test/jest.setup.ts'],
  testTimeout: 30000,
  testMatch: ['<rootDir>/apps/api/test/phase2.int.ts'],
  // Fastify static uses this ESM dependency; Jest 29 needs it transformed to CJS.
  transformIgnorePatterns: ['/node_modules/(?!content-disposition/)'],
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
  },
};

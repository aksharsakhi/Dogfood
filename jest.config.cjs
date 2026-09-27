module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/apps/api/test/**/*.spec.ts'],
  // Fastify static uses this ESM dependency; Jest 29 needs it transformed to CJS.
  transformIgnorePatterns: ['/node_modules/(?!content-disposition/)'],
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
  },
};

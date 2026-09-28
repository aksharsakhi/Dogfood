module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testTimeout: 30000,
  setupFiles: ['<rootDir>/apps/api/test/jest.setup.ts'],
  testMatch: [
    '<rootDir>/apps/api/test/t4b.*.spec.ts',
    '<rootDir>/apps/api/test/t4b.*.int.ts',
  ],
  transformIgnorePatterns: ['/node_modules/(?!content-disposition/)'],
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
  },
};

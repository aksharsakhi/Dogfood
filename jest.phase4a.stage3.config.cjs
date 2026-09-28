module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/apps/api/test/jest.setup.ts'],
  testTimeout: 30000,
  testMatch: ['<rootDir>/apps/api/test/phase4a.stage3.int.ts'],
  transformIgnorePatterns: ['/node_modules/(?!content-disposition/)'],
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
  },
};

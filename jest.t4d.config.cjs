module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testTimeout: 180000,
  setupFiles: ['<rootDir>/apps/api/test/jest.setup.ts'],
  testMatch: ['<rootDir>/apps/api/test/t4d.*.int.ts'],
  transformIgnorePatterns: ['/node_modules/(?!content-disposition/)'],
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
  },
};

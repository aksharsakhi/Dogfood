module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/apps/api/test/official-acceptance.int.ts'],
  transformIgnorePatterns: ['/node_modules/(?!content-disposition/)'],
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
  },
};

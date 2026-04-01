// server/jest.config.js — GAMP5 D6 Automated Test Configuration
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js'],
  // Run tests serially — DB operations must not interleave
  maxWorkers: 1,
  // 30s timeout per test (DB operations on Neon can be slow)
  testTimeout: 30000,
  // Coverage thresholds — GAMP5 requires evidence of test completeness
  coverageDirectory: './coverage',
  coverageReporters: ['text', 'text-summary', 'lcov', 'json-summary'],
  collectCoverageFrom: [
    'middleware/**/*.js',
    'routes/**/*.js',
    'services/**/*.js',
    'db/pool.js',
    '!**/node_modules/**',
  ],
};

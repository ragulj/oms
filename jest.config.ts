import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/test/**/*.spec.ts'],

  // FR-016: serial execution. SQLite admits one writer, so parallel workers
  // sharing a database would make lock contention look like a real defect.
  maxWorkers: 1,

  // FR-019: a run that executes zero tests is a build failure, not a pass.
  passWithNoTests: false,

  globalSetup: '<rootDir>/test/setup/global-setup.ts',
  globalTeardown: '<rootDir>/test/setup/global-teardown.ts',
  setupFilesAfterEnv: ['<rootDir>/test/setup/per-test.ts'],
  testTimeout: 15000,
};

export default config;

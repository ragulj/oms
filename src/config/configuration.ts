import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { configSchema, type AppConfig } from './config.schema';

export class ConfigValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'ConfigValidationError';
  }
}

/**
 * Uses Node's built-in env-file loader rather than a dependency. Missing file is
 * not an error: real environment variables are the source of truth (FR-005) and
 * the file is a developer convenience.
 */
export function loadEnvFile(path = '.env'): void {
  const absolute = resolve(path);
  if (existsSync(absolute)) {
    process.loadEnvFile(absolute);
  }
}

/** FR-006, FR-007: validate everything up front, name the offender on failure. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = configSchema.safeParse(env);
  if (parsed.success) {
    return parsed.data;
  }
  const issues = parsed.error.issues.map((issue) => {
    const setting = issue.path.join('.') || '(root)';
    return `${setting}: ${issue.message}`;
  });
  throw new ConfigValidationError(issues);
}

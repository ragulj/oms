import type { LoggerService } from '@nestjs/common';
import { redact } from './redact';

export const LOG_LEVELS = ['error', 'warn', 'info', 'debug', 'verbose'] as const;
export type AppLogLevel = (typeof LOG_LEVELS)[number];

const SEVERITY: Record<AppLogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  verbose: 4,
};

/**
 * FR-031: one machine-parseable format in every environment. There is no
 * pretty-printing branch on purpose, so what a test asserts on is exactly what
 * a developer reads.
 */
export class StructuredLogger implements LoggerService {
  constructor(
    private readonly threshold: AppLogLevel = 'info',
    private readonly sink: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
  ) {}

  emit(level: AppLogLevel, message: string, fields: Record<string, unknown> = {}): void {
    if (SEVERITY[level] > SEVERITY[this.threshold]) {
      return;
    }
    this.sink(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        message,
        ...(redact(fields) as Record<string, unknown>),
      }),
    );
  }

  log(message: unknown, ...rest: unknown[]): void {
    this.emit('info', String(message), context(rest));
  }

  error(message: unknown, ...rest: unknown[]): void {
    this.emit('error', String(message), context(rest));
  }

  warn(message: unknown, ...rest: unknown[]): void {
    this.emit('warn', String(message), context(rest));
  }

  debug(message: unknown, ...rest: unknown[]): void {
    this.emit('debug', String(message), context(rest));
  }

  verbose(message: unknown, ...rest: unknown[]): void {
    this.emit('verbose', String(message), context(rest));
  }
}

function context(rest: unknown[]): Record<string, unknown> {
  const last = rest.at(-1);
  return typeof last === 'string' ? { context: last } : {};
}

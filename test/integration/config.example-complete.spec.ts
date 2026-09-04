import { readFileSync } from 'node:fs';
import { configSchema } from '../../src/config/config.schema';

/**
 * User Story 4, scenario 4 and FR-008. The example file must enumerate every
 * recognised setting, so a developer copying it is never missing one, and must
 * carry no real secrets.
 */
describe('.env.example', () => {
  const contents = readFileSync('.env.example', 'utf8');

  const declaredKeys = contents
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => line.split('=')[0]);

  it('enumerates every setting the schema recognises', () => {
    const schemaKeys = Object.keys(configSchema.shape).sort();
    expect(declaredKeys.sort()).toEqual(schemaKeys);
  });

  it('parses into a valid configuration on its own', () => {
    const env: Record<string, string> = {};
    for (const line of contents.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
      const index = trimmed.indexOf('=');
      env[trimmed.slice(0, index)] = trimmed.slice(index + 1);
    }
    expect(() => configSchema.parse(env)).not.toThrow();
  });

  it('contains no real secrets', () => {
    expect(contents).not.toMatch(/(secret|password|token|api[-_]?key)\s*=\s*\S+/i);
  });
});

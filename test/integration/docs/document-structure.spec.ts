import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  collectRefs,
  createDocsHarness,
  documentedOperations,
  type DocsHarness,
  type JsonRecord,
} from '../../support/docs-fixtures';
import { API_VERSION, OPENAPI_VERSION } from '../../../src/docs/openapi.document';

/**
 * FR-047, FR-068, SC-008. Document-level shape, and the two absences that have
 * to be asserted because absence is invisible: no security scheme, and no
 * unresolved reference.
 */
describe('the published document is well formed', () => {
  let harness: DocsHarness;

  beforeAll(async () => {
    harness = await createDocsHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  it('declares the OpenAPI version explicitly', () => {
    expect(harness.document.openapi).toBe(OPENAPI_VERSION);
  });

  it('carries a title, a version and a description', () => {
    expect(harness.document.info.title.length).toBeGreaterThan(0);
    expect(harness.document.info.version).toBe(API_VERSION);
    expect((harness.document.info.description ?? '').length).toBeGreaterThan(200);
  });

  it('keeps the documented version in step with the package version', () => {
    const packageJson = JSON.parse(
      readFileSync(join(__dirname, '..', '..', '..', 'package.json'), 'utf8'),
    ) as { version: string };
    expect(harness.document.info.version).toBe(packageJson.version);
  });

  it('groups operations under exactly the two declared tags', () => {
    const declared = (harness.document.tags ?? []).map((tag) => tag.name).sort();
    expect(declared).toEqual(['Operations', 'Orders']);

    for (const operation of documentedOperations(harness.document)) {
      const tags = (operation.operation.tags ?? []) as string[];
      expect(tags).toHaveLength(1);
      expect(declared).toContain(tags[0]);
    }
  });

  it('declares no security scheme and no security requirement (FR-047)', () => {
    expect(harness.document.components?.securitySchemes).toBeUndefined();
    expect(harness.document.security).toBeUndefined();

    for (const operation of documentedOperations(harness.document)) {
      expect(operation.operation.security).toBeUndefined();
    }
  });

  it('states positively that the API requires no credentials (FR-046)', () => {
    expect(harness.document.info.description).toMatch(/requires no credentials/i);
  });

  it('resolves every internal reference and holds no external one (FR-068)', () => {
    const schemas = (harness.document.components?.schemas ?? {}) as JsonRecord;
    const refs = collectRefs(harness.document);

    expect(refs.length).toBeGreaterThan(0);
    for (const { path, ref } of refs) {
      expect(`${path} -> ${ref}`).toEqual(expect.stringContaining('#/components/schemas/'));
      const name = ref.replace('#/components/schemas/', '');
      expect(Object.keys(schemas)).toContain(name);
    }
  });

  it('publishes every component the contract names', () => {
    expect(Object.keys(harness.document.components?.schemas ?? {}).sort()).toEqual([
      'CreateOrderRequest',
      'ErrorBody',
      'ErrorDetail',
      'HealthReport',
      'ListOrdersResponse',
      'OrderLineView',
      'OrderStatus',
      'OrderView',
    ]);
  });

  it('emits no server list that could point the page at another environment', () => {
    expect(harness.document.servers ?? []).toHaveLength(0);
  });

  it('gives every operation a summary and a description', () => {
    for (const operation of documentedOperations(harness.document)) {
      expect(String(operation.operation.summary ?? '').length).toBeGreaterThan(0);
      expect(String(operation.operation.description ?? '').length).toBeGreaterThan(0);
    }
  });
});

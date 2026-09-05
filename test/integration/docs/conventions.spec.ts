import {
  createDocsHarness,
  walkDocument,
  type DocsHarness,
  type JsonRecord,
} from '../../support/docs-fixtures';
import {
  cancelledOrderViewExample,
  listOrdersResponseExample,
  orderViewExample,
} from '../../../src/docs/openapi.examples';

/**
 * FR-023, FR-024, FR-030, FR-078, SC-004. The two conventions Constitution
 * Principles IV and V protect, checked as properties of the published document.
 *
 * A document is believed. Showing a money field as 41.96, or a timestamp as an
 * ISO-8601 string, would teach a reader precisely the mistake those principles
 * exist to prevent, and would do it with the authority of the official
 * description. The naming convention Spec 003 chose, a `Minor` suffix on money
 * and a `Us` suffix on timestamps, is what makes this checkable by machine
 * rather than by review (research R11).
 */
describe('the document cannot contradict the money and timestamp conventions', () => {
  let harness: DocsHarness;

  beforeAll(async () => {
    harness = await createDocsHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  const propertyOffenders = (suffix: RegExp): string[] => {
    const offenders: string[] = [];
    walkDocument(harness.document, (node, path) => {
      const properties = node.properties as JsonRecord | undefined;
      if (!properties) return;
      for (const [name, schema] of Object.entries(properties)) {
        if (!suffix.test(name)) continue;
        const type = (schema as JsonRecord).type;
        if (type !== 'integer') offenders.push(`${path}.properties.${name}: type=${String(type)}`);
      }
    });
    return offenders;
  };

  it('types every monetary field as an integer (FR-023)', () => {
    expect(propertyOffenders(/Minor$/)).toEqual([]);
  });

  it('types every timestamp field as an integer (FR-024)', () => {
    expect(propertyOffenders(/Us$/)).toEqual([]);
  });

  it('carries no date or date-time format anywhere in the document (FR-024)', () => {
    const offenders: string[] = [];
    walkDocument(harness.document, (node, path) => {
      const format = node.format;
      if (typeof format === 'string' && ['date', 'date-time', 'time'].includes(format)) {
        offenders.push(`${path}: format=${format}`);
      }
    });
    expect(offenders).toEqual([]);
  });

  it('carries no numeric money or timestamp example that is not an integer', () => {
    const offenders: string[] = [];
    const check = (value: unknown, path: string): void => {
      if (Array.isArray(value)) {
        value.forEach((item, index) => check(item, `${path}[${index}]`));
        return;
      }
      if (typeof value !== 'object' || value === null) return;
      for (const [key, nested] of Object.entries(value as JsonRecord)) {
        if (/(?:Minor|Us)$/.test(key) && !Number.isInteger(nested)) {
          offenders.push(`${path}.${key} = ${JSON.stringify(nested)}`);
        }
        check(nested, `${path}.${key}`);
      }
    };

    walkDocument(harness.document, (node, path) => {
      if ('example' in node) check(node.example, `${path}.example`);
      if ('examples' in node) check(node.examples, `${path}.examples`);
    });

    expect(offenders).toEqual([]);
  });

  it('states both conventions in the document description', () => {
    const description = harness.document.info.description ?? '';
    expect(description).toMatch(/integer count of the minor unit/i);
    expect(description).toMatch(/microseconds since the Unix epoch/i);
  });

  it('keeps every example arithmetically consistent (FR-030)', () => {
    for (const example of [orderViewExample, cancelledOrderViewExample]) {
      let sum = 0;
      for (const line of example.lines) {
        expect(line.lineTotalMinor).toBe(line.unitPriceMinor * line.quantity);
        sum += line.lineTotalMinor;
      }
      expect(example.totalMinor).toBe(sum);
    }

    for (const order of listOrdersResponseExample.orders) {
      const sum = order.lines.reduce((total, line) => total + line.lineTotalMinor, 0);
      expect(order.totalMinor).toBe(sum);
    }
  });

  it('describes the cursor as opaque and gives no decodable example (FR-027)', () => {
    const schemas = harness.document.components?.schemas as JsonRecord;
    const listing = schemas.ListOrdersResponse as JsonRecord;
    const cursor = (listing.properties as JsonRecord).nextCursor as JsonRecord;

    expect(String(cursor.description)).toMatch(/opaque/i);
    expect(String(cursor.description)).toMatch(/not part of this contract/i);
    expect(cursor.pattern).toBeUndefined();
    expect(cursor.format).toBeUndefined();
    expect(listOrdersResponseExample.nextCursor).toBeNull();
  });
});

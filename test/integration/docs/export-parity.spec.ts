import { readFileSync } from 'node:fs';
import request from 'supertest';
import type { OpenAPIObject } from '@nestjs/swagger';
import { EXPORT_PATH, generateDocumentText } from '../../../scripts/export-openapi';
import {
  createDocsHarness,
  documentedOperations,
  type DocsHarness,
} from '../../support/docs-fixtures';

/**
 * FR-067, FR-083. The committed `openapi.json` and the document the running
 * service serves are the same contract.
 *
 * The export gate in `npm run check` compares the committed file against a
 * freshly generated one, so it catches a stale file. It cannot catch the export
 * script drifting from what the service actually mounts, because both sides of
 * that comparison come from the script. This file supplies the missing side: it
 * takes the document off the wire from a running application and compares it to
 * the file on disk.
 */
describe('the committed export and the served document agree', () => {
  let harness: DocsHarness;
  let committed: OpenAPIObject;
  let served: OpenAPIObject;

  beforeAll(async () => {
    harness = await createDocsHarness();
    committed = JSON.parse(readFileSync(EXPORT_PATH, 'utf8')) as OpenAPIObject;
    served = (await request(harness.server).get('/docs-json')).body as OpenAPIObject;
  });

  afterAll(async () => {
    await harness.close();
  });

  it('describes the same operations, in both directions (FR-067)', () => {
    const identify = (document: OpenAPIObject): string[] =>
      documentedOperations(document)
        .map((operation) => `${operation.method} ${operation.path} ${operation.operationId}`)
        .sort();

    expect(identify(served)).toEqual(identify(committed));
  });

  it('publishes the same components', () => {
    expect(Object.keys(served.components?.schemas ?? {}).sort()).toEqual(
      Object.keys(committed.components?.schemas ?? {}).sort(),
    );
  });

  it('declares the same version, title and tags', () => {
    expect(served.openapi).toBe(committed.openapi);
    expect(served.info.title).toBe(committed.info.title);
    expect(served.info.version).toBe(committed.info.version);
    expect((served.tags ?? []).map((tag) => tag.name)).toEqual(
      (committed.tags ?? []).map((tag) => tag.name),
    );
  });

  /**
   * The assertion the two above are a readable decomposition of. They exist so a
   * failure names what moved; this one exists so nothing can move unnoticed.
   */
  it('is the same document in every respect (FR-083)', () => {
    expect(served).toEqual(committed);
  });

  it('is what the export script would write right now (FR-066)', async () => {
    const generated = await generateDocumentText();
    expect(generated).toBe(readFileSync(EXPORT_PATH, 'utf8'));
  });

  it('generates identically twice, so the gate is a contract check and not a diff of noise (SC-009)', async () => {
    const [first, second] = await Promise.all([generateDocumentText(), generateDocumentText()]);
    expect(first).toBe(second);
  });
});

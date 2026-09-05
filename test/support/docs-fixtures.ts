import type { OpenAPIObject } from '@nestjs/swagger';
import { createLifecycleHarness, type LifecycleHarness } from './http-fixtures';
import { DOCUMENTATION_PATHS } from '../../src/docs/openapi.document';

export interface DocsHarness extends LifecycleHarness {
  document: OpenAPIObject;
}

/**
 * FR-084. Documentation is mounted through the same function `main.ts` calls, on
 * the same application graph every other integration test drives, so what these
 * suites assert about is what the service publishes rather than a document
 * assembled for the occasion.
 */
export async function createDocsHarness(
  env: Record<string, string> = {},
): Promise<DocsHarness> {
  const harness = await createLifecycleHarness({ DOCS_ENABLED: 'true', ...env });
  if (!harness.document) {
    throw new Error('The harness mounted no document. DOCS_ENABLED was not honoured.');
  }
  return harness as DocsHarness;
}

export type JsonRecord = Record<string, unknown>;

export interface DocumentedOperation {
  method: string;
  path: string;
  operationId: string;
  operation: JsonRecord;
}

/** Every operation in the document, flattened, so a suite can assert over all of them. */
export function documentedOperations(document: OpenAPIObject): DocumentedOperation[] {
  const operations: DocumentedOperation[] = [];
  for (const [path, item] of Object.entries(document.paths ?? {})) {
    for (const [method, operation] of Object.entries(item as JsonRecord)) {
      if (typeof operation !== 'object' || operation === null) continue;
      const record = operation as JsonRecord;
      operations.push({
        method: method.toUpperCase(),
        path,
        operationId: String(record.operationId ?? ''),
        operation: record,
      });
    }
  }
  return operations;
}

/**
 * The framework's not-found handler and the documentation's own routes are the
 * only things excluded from the coverage comparison. Both are enumerated rather
 * than matched by prefix: a filter that dropped everything starting `/docs`
 * would also swallow a future API route named that way, and this comparison
 * exists precisely to catch a route nobody documented.
 */
const CATCH_ALL_PATHS = new Set(['*path', '/*path', '*']);

export function isExcludedRoute(path: string): boolean {
  if (CATCH_ALL_PATHS.has(path)) return true;
  if ((DOCUMENTATION_PATHS as readonly string[]).includes(path)) return true;
  // Swagger UI's static assets, all of which live under the page path.
  return path === '/docs/' || path.startsWith('/docs/');
}

export interface RoutedOperation {
  method: string;
  path: string;
}

interface ExpressLayer {
  name?: string;
  handle?: { stack?: ExpressLayer[] };
  route?: { path?: string | string[]; methods?: Record<string, boolean> };
}

/**
 * Express 5 exposes the router at `app.router`; the Express 4 `app._router` is
 * gone (research R9). Paths are converted from Express syntax to OpenAPI syntax
 * so the two sets are comparable.
 */
export function routedOperations(server: unknown): RoutedOperation[] {
  const instance = (server as { _events?: { request?: unknown } })._events?.request ?? server;
  const app = instance as { router?: { stack: ExpressLayer[] }; _router?: { stack: ExpressLayer[] } };
  const router = app.router ?? app._router;
  if (!router) {
    throw new Error('No Express router found. The adapter or Express major version changed.');
  }

  const found: RoutedOperation[] = [];
  const walk = (stack: ExpressLayer[]): void => {
    for (const layer of stack) {
      if (layer.route?.path !== undefined) {
        const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
        for (const path of paths) {
          for (const method of Object.keys(layer.route.methods ?? {})) {
            found.push({ method: method.toUpperCase(), path: toOpenApiPath(path) });
          }
        }
      } else if (layer.handle?.stack) {
        walk(layer.handle.stack);
      }
    }
  };
  walk(router.stack);
  return found;
}

export function toOpenApiPath(expressPath: string): string {
  return expressPath.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

/**
 * Depth-first walk over every node of the document, reporting a JSON-pointer
 * style path. Several requirements are properties of the whole document rather
 * than of one operation, and this is how they are checked.
 */
export function walkDocument(
  root: unknown,
  visit: (node: JsonRecord, path: string) => void,
  path = '$',
): void {
  if (Array.isArray(root)) {
    root.forEach((item, index) => walkDocument(item, visit, `${path}[${index}]`));
    return;
  }
  if (typeof root !== 'object' || root === null) return;

  const node = root as JsonRecord;
  visit(node, path);
  for (const [key, value] of Object.entries(node)) {
    walkDocument(value, visit, `${path}.${key}`);
  }
}

/** Every `$ref` string in the document, with the path it was found at. */
export function collectRefs(document: OpenAPIObject): { path: string; ref: string }[] {
  const refs: { path: string; ref: string }[] = [];
  walkDocument(document, (node, path) => {
    if (typeof node.$ref === 'string') refs.push({ path, ref: node.$ref });
  });
  return refs;
}

/** The error codes an operation advertises, taken from its named response examples. */
export function advertisedErrorCodes(operation: JsonRecord): string[] {
  const responses = (operation.responses ?? {}) as Record<string, JsonRecord>;
  const codes = new Set<string>();
  for (const response of Object.values(responses)) {
    const content = response.content as Record<string, JsonRecord> | undefined;
    const examples = content?.['application/json']?.examples as JsonRecord | undefined;
    for (const code of Object.keys(examples ?? {})) codes.add(code);
  }
  return [...codes].sort();
}

export function statusesOf(operation: JsonRecord): number[] {
  return Object.keys((operation.responses ?? {}) as JsonRecord)
    .map(Number)
    .sort((a, b) => a - b);
}

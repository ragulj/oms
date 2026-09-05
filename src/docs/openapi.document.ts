import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { buildComponentSchemas } from './openapi.schemas';

/** contracts/openapi-document.md. All three sit outside the `/api/v1` prefix. */
export const DOCS_UI_PATH = 'docs';
export const DOCS_JSON_PATH = 'docs-json';
export const DOCS_YAML_PATH = 'docs-yaml';

export const OPENAPI_VERSION = '3.1.0';

/**
 * Tracks the `version` field of package.json. Not imported from it: the build
 * config roots at `src/`, so a relative import would not survive compilation.
 * document-structure.spec.ts asserts the two still agree.
 */
export const API_VERSION = '0.1.0';

export const TAG_ORDERS = 'Orders';
export const TAG_OPERATIONS = 'Operations';

/**
 * FR-007, FR-038, FR-046. Four statements live here rather than on individual
 * operations, each for a reason:
 *
 * The money and timestamp conventions are properties of the whole API, and a
 * reader who misses them misreads every numeric field in the document.
 *
 * The server-error statement is here because FR-038 forbids listing a 500 on any
 * operation. A caller-constructible input cannot produce one, so documenting it
 * per operation would put a response on every operation that no test can
 * provoke, and SC-003 would need an exemption it deliberately does not have.
 *
 * The credentials statement is here because FR-046 requires stating the absence
 * positively. Saying nothing would leave a reader unsure whether the omission
 * was a decision or an oversight.
 */
const DESCRIPTION = [
  'Order Processing System. Create orders, read them back, page through them, and cancel one.',
  '',
  '**Authentication.** This API requires no credentials of any kind. There is no key, token, session or',
  'header to supply, and no authorisation rule about who may read or cancel whose order. That is a',
  'declared boundary of this system rather than an oversight, and no credential scheme is configured or',
  'planned within this scope.',
  '',
  '**Money** is always an integer count of the minor unit of the currency, on every field whose name ends',
  '`Minor`. No field carries a decimal, a floating point value, or a formatted amount.',
  '',
  '**Timestamps** are always an integer count of microseconds since the Unix epoch, on every field whose',
  'name ends `Us`. There is deliberately no formatted or millisecond-precision rendering of an ordering',
  'timestamp anywhere in this API, because that is the value a client would reach for when building its',
  'own pagination cursor, and it is truncated.',
  '',
  '**Cursors are opaque.** Read `nextCursor` from a response and pass it back unchanged. Its encoding is',
  'not part of this contract, and a cursor a client constructs itself is not supported.',
  '',
  '**Errors** all share one body, published as the `ErrorBody` component. Its `code` is stable and',
  'machine-readable; branch on that rather than on `message`. No error body contains a stack trace, a',
  'driver message, a query fragment or a filesystem path.',
  '',
  '**Server errors.** A `500` response carrying the same error body is representable, as it is for any',
  'service. It is documented here once rather than on each operation, because no input a caller can',
  'construct produces one, and listing an unprovokable response per operation would weaken the',
  'guarantee that every documented failure is a failure that has actually been exercised.',
  '',
  '**There is no operation that updates or deletes an order.** A stored order is permanent: it always',
  'carries at least one line item, line items cannot be deleted, and the order cannot be removed while',
  'a line references it. Cancellation is the answer this lifecycle offers to an unwanted order.',
  'There are also no customer or product operations, and no offset-style paging parameter.',
].join('\n');

/**
 * FR-047. `addGlobalResponse` is deliberately not called here. Its name reads as
 * "one response at document level", and it in fact copies the response into
 * every operation, which is exactly what FR-038 forbids (research R7).
 * failure-documentation.spec.ts asserts no operation carries a 500, because this
 * is a trap a later contributor would walk into by reading the method name.
 *
 * No security scheme is declared, and none may be. An empty scheme still renders
 * a credential input on the page, implying a check that does not exist.
 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Order Processing System API')
    .setDescription(DESCRIPTION)
    .setVersion(API_VERSION)
    .setOpenAPIVersion(OPENAPI_VERSION)
    .addTag(TAG_ORDERS, 'Placing, reading and cancelling orders.')
    .addTag(TAG_OPERATIONS, 'Operational endpoints, outside the versioned API prefix.')
    .build();

  const document = SwaggerModule.createDocument(app, config);

  document.components = {
    ...document.components,
    schemas: {
      ...(document.components?.schemas ?? {}),
      ...buildComponentSchemas(),
    },
  };

  return document;
}

/** FR-049, FR-057. Mounted only when documentation is enabled. */
export function mountApiDocumentation(app: INestApplication): OpenAPIObject {
  const document = buildOpenApiDocument(app);
  SwaggerModule.setup(DOCS_UI_PATH, app, document, {
    jsonDocumentUrl: DOCS_JSON_PATH,
    yamlDocumentUrl: DOCS_YAML_PATH,
    swaggerOptions: {
      // The reviewer's first useful action is reading, so operations start
      // collapsed rather than fully expanded.
      docExpansion: 'list',
      // FR-050: the page must reach the same code path as any other client. It
      // is served from the same origin as the API, so no server override and no
      // cross-origin configuration exists here.
      tryItOutEnabled: true,
    },
  });
  return document;
}

/**
 * The two paths a caller can be pointed at. `/docs-yaml` is registered by the
 * library whether or not it is wanted (research R3) and is covered by the
 * disable and prefix assertions, but it is not advertised.
 */
export const DOCUMENTATION_PATHS = [
  `/${DOCS_UI_PATH}`,
  `/${DOCS_JSON_PATH}`,
  `/${DOCS_YAML_PATH}`,
] as const;

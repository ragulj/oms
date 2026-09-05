/**
 * The parts of the underlying HTTP objects this application actually touches.
 *
 * Declared structurally rather than by installing `@types/express`, so this
 * feature adds no dependency at all, and so the surface the HTTP layer depends
 * on is visible in one place instead of being an open-ended framework type.
 */
export interface HttpRequestLike {
  headers: Record<string, string | string[] | undefined>;
  method: string;
  path: string;
}

export interface HttpResponseLike {
  setHeader(name: string, value: string): unknown;
  status(code: number): HttpResponseLike;
  json(body: unknown): unknown;
}

export type NextLike = () => void;

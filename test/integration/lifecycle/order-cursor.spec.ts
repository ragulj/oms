import { decodeCursor, encodeCursor } from '../../../src/orders/order-cursor';

/**
 * User Story 3, and FR-048 to FR-050.
 *
 * Constitution Principle V requires the cursor to carry the full microsecond
 * value together with a unique tiebreaker. Millisecond truncation makes rows
 * sharing a timestamp either repeat across pages or vanish between them, so the
 * round-trip below is the property the whole listing rests on.
 */
describe('the order page cursor', () => {
  it('round-trips the full microsecond value and the tiebreaker', () => {
    const cases = [
      { createdAtUs: 1, id: 1 },
      { createdAtUs: 1_700_000_000_123_456, id: 42 },
      { createdAtUs: 9_007_199_254_740_991, id: 9_007_199_254_740_991 },
    ];

    for (const cursor of cases) {
      expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
    }
  });

  /**
   * The specific failure Principle V names. A cursor that went through a
   * millisecond-resolution representation would lose these last three digits and
   * silently reposition the traversal.
   */
  it('preserves microsecond digits that a millisecond representation would drop', () => {
    const base = 1_700_000_000_123_000;

    for (let offset = 0; offset < 1000; offset += 137) {
      const cursor = { createdAtUs: base + offset, id: 7 };
      expect(decodeCursor(encodeCursor(cursor)).createdAtUs).toBe(base + offset);
    }

    // Distinct microseconds inside one millisecond must produce distinct tokens.
    const tokens = new Set(
      Array.from({ length: 20 }, (_, i) => encodeCursor({ createdAtUs: base + i, id: 7 })),
    );
    expect(tokens.size).toBe(20);
  });

  it('produces an opaque token rather than something a client would hand-build', () => {
    const token = encodeCursor({ createdAtUs: 1_700_000_000_123_456, id: 42 });

    expect(token).not.toContain('1700000000123456');
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  /**
   * FR-050. Rejected, never treated as an absent cursor: silently restarting the
   * traversal at page one looks to a caller exactly like a page of results.
   */
  it.each([
    ['not base64url', '!!!not-base64!!!'],
    ['structurally wrong', Buffer.from('1700000000123456', 'utf8').toString('base64url')],
    ['too many parts', Buffer.from('1.2.3', 'utf8').toString('base64url')],
    ['non-numeric', Buffer.from('abc.def', 'utf8').toString('base64url')],
    ['negative', Buffer.from('-5.-5', 'utf8').toString('base64url')],
    ['beyond the exact range', Buffer.from('99999999999999999999.1', 'utf8').toString('base64url')],
    ['empty', ''],
  ])('rejects a cursor that is %s', (_name, token) => {
    expect(() => decodeCursor(token)).toThrow(
      expect.objectContaining({ code: 'INVALID_CURSOR', status: 400 }),
    );
  });
});

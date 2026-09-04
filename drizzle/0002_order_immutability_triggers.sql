-- Custom SQL migration file, put your code below! --

-- Constitution Principle IV requires immutability to be enforced by a SQLite
-- trigger, and forbids relying on an application-layer guard. Drizzle exposes no
-- trigger construct, so these four live here rather than in a schema module.
-- That gap is recorded in the plan's Complexity Tracking section.
--
-- Each statement is separated by a statement-breakpoint marker because the
-- migrator splits on that marker, not on semicolons, and a trigger body contains
-- semicolons inside BEGIN ... END.

-- FR-021, FR-022, FR-023. Every column on this table is immutable, so a blanket
-- guard is correct: there is no column a legitimate caller may change, and
-- nothing for a narrower trigger to permit.
CREATE TRIGGER order_line_items_immutable
BEFORE UPDATE ON order_line_items
BEGIN
  SELECT RAISE(ABORT, 'order_line_items are immutable: a stored line item cannot be updated');
END;
--> statement-breakpoint

-- FR-025a. An update and a deletion rewrite financial history equally well, so a
-- rule covering only one of them protects nothing the other cannot reach.
CREATE TRIGGER order_line_items_undeletable
BEFORE DELETE ON order_line_items
BEGIN
  SELECT RAISE(ABORT, 'order_line_items cannot be deleted: cancel the order instead');
END;
--> statement-breakpoint

-- FR-024. Guarded on an actual change rather than on every update touching the
-- row, so the touch trigger below does not trip it.
CREATE TRIGGER orders_created_at_frozen
BEFORE UPDATE OF created_at_us ON orders
WHEN NEW.created_at_us <> OLD.created_at_us
BEGIN
  SELECT RAISE(ABORT, 'orders.created_at_us is immutable');
END;
--> statement-breakpoint

-- FR-034a. Maintained here so no write path can leave it stale, and so the
-- conditional status update keeps the exact shape Constitution Principle II
-- mandates rather than growing a timestamp assignment that principle does not
-- describe.
--
-- FR-034b: this must not inflate the changed-row count the caller observes,
-- because Principle II decides the 409 response from that number. SQLite's
-- changed-row counter excludes rows modified by triggers, and recursive_triggers
-- defaults to off so this does not re-enter itself. Both are asserted in
-- test/integration/orders/engine-assumptions.spec.ts rather than assumed.
--
-- The MAX is not decoration. SQLite's clock resolves to milliseconds, so a bare
-- reading can land below a created_at_us that the write path set with true
-- microsecond precision, which would trip the orders_updated_at_us_valid check
-- and abort a legitimate status change. Taking the later of the clock and the
-- previous value plus one microsecond makes the column monotonic, keeps it at or
-- above created_at_us by construction, and makes every update advance it
-- strictly even when two land inside the same millisecond.
CREATE TRIGGER orders_touch_updated_at
AFTER UPDATE ON orders
BEGIN
  UPDATE orders
  SET updated_at_us = MAX(
    CAST(unixepoch('now', 'subsec') * 1000000 AS INTEGER),
    OLD.updated_at_us + 1
  )
  WHERE id = OLD.id;
END;

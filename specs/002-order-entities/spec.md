# Feature Specification: Order Entities

**Feature Branch**: `002-order-entities`

**Created**: 2026-09-05

**Status**: Draft

**Input**: User description: "Create Spec 002: Order Entities. Define the persistent data model for Orders and Order Line Items. Focus on: Order and Order Line Item entities; fields and required data; relationships; primary and foreign keys; constraints and data invariants; integer-based monetary values; order status representation needed by the lifecycle; timestamps; indexes based on expected access patterns. Assume all relevant external entities/tables already exist. If the requirements reference such entities, treat them as existing dependencies and do not define, create, or modify them in this spec. Do not cover APIs, order creation, get/list behavior, state transitions, cancellation, background processing, or business workflows."

## Clarifications

### Session 2026-09-05

- Q: How should references to the customer and product entities be constrained, given that
  foreign key enforcement is on and this repository contains no such tables? → A: Declare real
  foreign keys and create minimal placeholder tables for customer and product here. This
  reverses the feature description's instruction to treat those entities as existing and define
  nothing about them. It was chosen because it is the only option under which the guarantees in
  this specification are verifiable in this repository: an undeclared reference proves nothing
  about referential integrity, and a declared reference to a table that does not exist fails
  every insert. The placeholder tables are owned by no specification and are expected to be
  replaced, not extended.
- Q: Which values does the order status set contain? → A: Exactly `pending`, `processing`, and
  `cancelled`, with `pending` as the initial value. Only the values something in the declared
  scope actually reaches. Fulfilment statuses such as shipped and delivered were rejected
  because nothing in scope writes them, and a permitted value no code path can produce is
  indistinguishable at read time from a value the state machine has forgotten how to reach.
- Q: Should the database also block deleting a stored line item, or only block updating one? → A:
  Block deletion too. An `UPDATE` and a `DELETE` rewrite financial history equally well, so the
  guarantee covers both. This makes a stored order undeletable in practice and stops the test
  suite from clearing these tables with row deletion, so isolation for them is achieved by
  rebuilding rather than clearing. That deviates from the mechanism Constitution Principle VI
  names and MUST be recorded in the implementation plan's Complexity Tracking section.
- Q: When an order's status changes, what guarantees that its last-changed timestamp moves with
  it? → A: A database trigger sets it on every update to the row. Leaving it to each write path
  would make it the only invariant here enforced by remembering, and the bounded claim in
  Constitution Principle III issues a bare conditional update with no natural place to set a
  timestamp. The trigger MUST NOT change the changed-row count the caller observes, because
  Principle II decides the 409 response from exactly that number.
- Q: Can the same product appear on two separate line items within one order, or must each
  product appear at most once? → A: Duplicates are permitted, and no uniqueness constraint spans
  order and product. Quantity is a property of a line rather than of a product within an order.
  Forbidding duplicates was rejected because merging repeated products is order-creation
  behaviour, which this specification excludes, and a schema constraint is the wrong place to
  introduce a workflow rule.
- Q: What is the largest monetary amount the model accepts, above which a write is rejected? → A:
  9,007,199,254,740,991, which is 2^53 - 1, the largest integer the application runtime
  represents exactly. The database column holds wider values than that, so the bound is a stated
  constraint rather than a property of the storage type. A domain ceiling was rejected because it
  would be an invented number, and the limit that matters is the one where correctness breaks
  rather than one where plausibility does.
- Q: Is the order total stored on the order, or derived from its line items? → A: Derived, and
  not stored. A stored total cannot be held by the database here, because a check constraint
  admits no subquery and a row trigger cannot validate a multi-row sum while the transaction is
  still inserting lines. Since the mandated read shape already fetches the line items for every
  order on a page, deriving the total costs nothing and removes the possibility of drift.

## User Scenarios & Testing *(mandatory)*

This specification delivers no callable surface. Its user is the rest of the system: the write
path that records an order, the read path that pages through orders, the background job that
claims a backlog, and every later specification that assumes an order can be trusted once it
is stored. Value is measured by what the stored data refuses to become.

Each story below is exercised directly against a real database, per Constitution Principle
VI. No story needs an API, a service layer, or a scheduler to be verifiable.

### User Story 1 - Record an order and read back exactly what was written (Priority: P1)

An order and the line items belonging to it are written as a single unit of work, and every
field comes back with the same value and the same type it went in with. Nothing is coerced,
widened, truncated, or defaulted behind the caller's back.

**Why this priority**: Every other guarantee in this specification is a statement about stored
data. If a round trip is not faithful, none of them can be observed, and no later
specification can build on the model. This is the smallest independently valuable slice.

**Independent Test**: Insert one order with several line items, read them back by primary key,
and compare every column against what was supplied. Requires no other story.

**Acceptance Scenarios**:

1. **Given** an empty database, **When** an order and its line items are inserted together,
   **Then** reading the order by its primary key returns every stored field unchanged, and
   reading by the order's identifier returns exactly the line items that were inserted.
2. **Given** an attempt to insert an order that omits a required field, **When** the write is
   attempted, **Then** the database rejects it rather than substituting a value.
3. **Given** an attempt to insert a line item referencing an order that does not exist, **When**
   the write is attempted, **Then** the database rejects it.
4. **Given** an attempt to insert an order naming a customer that does not exist, or a line item
   naming a product that does not exist, **When** the write is attempted, **Then** the database
   rejects it.
5. **Given** a stored order, **When** its line items are read, **Then** they come back in a
   deterministic order that is identical on every read.
6. **Given** a stored order, **When** its total is needed, **Then** it equals the sum of its line
   totals, and no total is stored on the order itself.

---

### User Story 2 - Money stays exact (Priority: P2)

Every monetary value written, read, summed, or multiplied produces the exact integer a person
would compute by hand. No value acquires a fractional component, and no value silently loses
precision at any magnitude the model permits.

**Why this priority**: Constitution Principle IV exists because this failure is silent. A
rounding error does not raise, it just makes a total wrong by a unit, and the storage layer is
the only place that can make the error impossible rather than unlikely.

**Independent Test**: Write monetary values at and beyond the boundaries the model permits,
read them back, and assert exact integer equality. Attempt to store a fractional value and
assert rejection. Requires only User Story 1's tables.

**Acceptance Scenarios**:

1. **Given** a line item with a captured unit price and a quantity, **When** its line total is
   read, **Then** it equals unit price multiplied by quantity exactly, with no fractional part.
2. **Given** an attempt to store a fractional value in any monetary field, **When** the write is
   attempted, **Then** it is rejected rather than rounded or truncated.
3. **Given** an attempt to store a negative unit price, or a quantity below one, **When** the
   write is attempted, **Then** it is rejected.
4. **Given** monetary values at the largest magnitude the model permits, **When** they are read
   back and summed, **Then** the result is exact and no value has been converted to an
   approximate representation.

---

### User Story 3 - Historical line items cannot be rewritten (Priority: P3)

Once a line item is recorded against an order, what was captured at that moment is permanent.
A later catalog change, a defect in a service, or a statement issued by hand cannot alter what
the customer was charged.

**Why this priority**: This is the guarantee that makes a stored order admissible as a
financial record. Constitution Principle IV requires it to hold at the database level
precisely because an application-layer rule is one forgotten code path away from failing.

**Independent Test**: Insert a line item, then attempt to update its captured price and its
quantity by direct statement. Assert both are rejected and the stored row is unchanged.
Requires only User Story 1's tables.

**Acceptance Scenarios**:

1. **Given** a stored line item, **When** an update to its captured unit price is attempted by
   any means, **Then** the database aborts the statement and the stored value is unchanged.
2. **Given** a stored line item, **When** an update to its quantity is attempted, **Then** the
   database aborts the statement and the stored value is unchanged.
3. **Given** a stored order with line items, **When** deletion of the order is attempted while
   its line items still exist, **Then** the database refuses, rather than removing the
   financial history along with it.
4. **Given** a stored order, **When** an update to its creation timestamp is attempted, **Then**
   the database aborts the statement.
5. **Given** a line item recorded against a product, **When** that product's catalog price and
   name are subsequently changed, **Then** the line item still reports the price and description
   captured when the order was placed.
6. **Given** a stored line item, **When** deletion of that line item is attempted directly,
   **Then** the database aborts the statement and the row remains.
7. **Given** a stored order, **When** deletion of the order is attempted after every route to
   removing its line items has been tried, **Then** the order still exists.

---

### User Story 4 - Status is a closed set that supports a conditional write (Priority: P4)

The status field admits only values the lifecycle recognises, and it has the shape the atomic
transition in Constitution Principle II depends on: a conditional update naming both the
identity and the expected current status reports exactly one changed row when it applies, and
zero when it does not.

**Why this priority**: The state machine and its transitions belong to a later specification,
but that specification cannot be written against a field that accepts arbitrary text. The
closed value set and the observable changed-row count are storage guarantees, and they are
what makes the 409 response in Principle II decidable at all.

**Independent Test**: Attempt to store a status outside the permitted set and assert rejection.
Issue a conditional update with a matching expected status and assert one changed row, then
issue the same update again and assert zero. Requires only User Story 1's tables.

**Acceptance Scenarios**:

1. **Given** an attempt to store a status value outside the permitted set, **When** the write is
   attempted, **Then** the database rejects it.
2. **Given** a stored order in a known status, **When** a conditional update naming that status
   as expected is issued, **Then** exactly one row is reported as changed.
3. **Given** that same conditional update issued a second time, **When** it runs, **Then** zero
   rows are reported as changed and no stored value differs.
4. **Given** a newly inserted order for which no status was supplied, **When** it is read back,
   **Then** it carries `pending` as its status.
5. **Given** a stored order whose status is changed by a conditional update that sets no
   timestamp, **When** the order is read back, **Then** its last-changed timestamp has advanced
   and its creation timestamp has not.
6. **Given** a conditional update that matches no row, **When** it runs, **Then** the changed-row
   count is zero and no order's last-changed timestamp has moved.

---

### User Story 5 - The queries the system will run are served by indexes (Priority: P5)

The three access patterns this system is already committed to, by the constitution rather than
by speculation, are each served by an index instead of a full table scan: a keyset page of
orders, a bounded claim of the oldest orders in a given status, and a fetch of line items for a
set of order identifiers.

**Why this priority**: Constitution Principles III and V describe query shapes that are only
safe if the database can satisfy them without scanning. An unindexed backlog claim holds the
single write lock for the length of a whole-table scan, which is the exact failure Principle
III exists to prevent. Indexing is therefore part of the data model, not a later optimisation.

**Independent Test**: Populate the tables, then inspect the query plan for each of the three
statement shapes and assert none reports a full scan of a domain table. Requires only User
Story 1's tables.

**Acceptance Scenarios**:

1. **Given** a populated orders table, **When** a page is requested by keyset predicate over the
   ordering timestamp and its tiebreaker, **Then** the plan uses an index and does not scan the
   table.
2. **Given** a populated orders table, **When** the oldest rows in a given status are selected
   under a row limit, **Then** the plan uses an index and does not scan the table.
3. **Given** a populated line items table, **When** line items are fetched for a set of order
   identifiers, **Then** the plan uses an index and does not scan the table.
4. **Given** two orders created within the same microsecond, **When** they are paged with a
   keyset cursor, **Then** the ordering is total, and neither row repeats across pages nor
   disappears between them.

---

### Edge Cases

- What happens when two orders are created within the same microsecond? The ordering stays
  total, because the cursor carries a unique tiebreaker alongside the timestamp.
- What happens when an order is written but its line items fail to insert? The unit of work
  leaves no order row behind, because an order with no line items is not a valid order.
- What happens when a quantity is zero or negative? Rejected. A line charging for nothing is a
  data defect, not a business case.
- What happens when a unit price is zero? Permitted. A promotional or bundled line legitimately
  carries no charge, and the invariant that matters is the absence of negative money.
- What happens when a monetary value exceeds 2^53 - 1? Rejected at write time, rather than stored
  and read back wrong. The storage type would hold it, which is exactly why the limit has to be
  stated as a constraint instead of inherited from the column.
- What happens when an order accumulates enough conforming line totals that their sum exceeds
  2^53 - 1? No column constraint can catch it, so the derivation of the order total has to detect
  it and fail rather than return a rounded number.
- What happens when a line item references an order that is later deleted? The deletion is
  refused. Financial history is not removable by cascade.
- What happens when the same customer appears on many orders, or the same product on many line
  items? Nothing. Each reference is a foreign key, not a unique one.
- What happens when the same product appears twice within one order? Both lines stand, each with
  its own quantity and its own captured price. Whether they should have been one line is a
  question for whatever creates orders, not for the schema.
- What happens when a customer or a product that is still referenced is deleted? The deletion is
  refused, for the same reason order deletion is: a catalog edit must not be able to remove a
  financial record as a side effect.
- What happens when a product's catalog price changes after an order was placed? Nothing visible
  on the order. The line item holds the price captured at the time, and that is the value every
  historical read returns.
- What happens when a test needs to start from an empty orders table? It rebuilds the tables
  rather than clearing them, because row deletion is refused. This is the cost of FR-025a and is
  paid by the test harness rather than by weakening the guarantee.
- What happens when an order is created in error and someone wants it gone? Nothing removes it.
  The lifecycle offers `cancelled`, and that is the only correct answer. A record that can be
  made to disappear is not a financial record.
- What happens when a status value that is valid today leaves the lifecycle later? Existing rows
  keep their stored value, and the change requires a migration that states what becomes of them.
  The schema cannot silently reinterpret history.
- What happens when a clock adjustment produces a creation timestamp earlier than an existing
  row's? The row is still stored and still ordered by its stored value. The model guarantees a
  total order, not a monotonic one.
- What happens when a write path updates an order and forgets to set the last-changed timestamp?
  Nothing goes stale. The database sets it, so forgetting is not a failure mode that exists.
- What happens when two updates to one order land within the same microsecond? The last-changed
  timestamp may be identical after both. It orders nothing and carries no tiebreaker, unlike the
  creation timestamp, so an equal value is a legitimate reading rather than a defect.

## Requirements *(mandatory)*

### Functional Requirements

**Entities and identity**

- **FR-001**: The data model MUST define two domain entities, Order and Order Line Item, and two
  minimal reference tables, Customer and Product, that exist only to give the foreign keys in
  FR-010 something real to point at. It MUST NOT define or modify any other table.
- **FR-001a**: The Customer and Product tables MUST be minimal by construction: an identifier, a
  display name, and for Product a current unit price in minor units, which exists so that the
  divergence between a catalog price and a captured price in FR-014 is demonstrable rather than
  asserted. They MUST carry no timestamps, no status, no soft-delete flag, and no index beyond
  their primary keys. A later specification that owns these entities is expected to replace
  them, not extend them.
- **FR-002**: Each Order MUST carry a single-column primary key that is unique for the lifetime
  of the database and is never reused after deletion.
- **FR-003**: Each Order Line Item MUST carry a single-column primary key that is unique for the
  lifetime of the database and independent of the Order it belongs to.
- **FR-004**: Both primary keys MUST be usable as the unique tiebreaker in a keyset cursor, per
  Constitution Principle V, meaning they MUST be totally ordered and MUST NOT be null.

**Relationships and foreign keys**

- **FR-005**: Each Order Line Item MUST reference exactly one Order through a foreign key, and
  that reference MUST be required.
- **FR-006**: The database MUST reject an Order Line Item whose Order reference does not
  correspond to an existing Order.
- **FR-007**: Deleting an Order that still has Order Line Items MUST be refused by the database.
  The relationship MUST NOT cascade deletions, because cascading would let a single statement
  destroy financial history that Constitution Principle IV requires to be immutable.
- **FR-008**: An Order MUST have at least one Order Line Item. The write path MUST establish
  this within the same unit of work that creates the Order, and MUST NOT leave an Order without
  line items visible to any reader. This invariant cannot be expressed as a table constraint,
  because the Order row necessarily exists before its first line item can reference it, so the
  specification states where it is enforced rather than pretending the schema holds it.
- **FR-009**: The Order MUST carry a required reference to the customer it belongs to, and each
  Order Line Item MUST carry a required reference to the product it was placed for.
- **FR-010**: Both references MUST be declared foreign keys, enforced by the database, to the
  minimal Customer and Product tables defined in FR-001a. The database MUST reject an Order
  naming a customer that does not exist, and an Order Line Item naming a product that does not
  exist.
- **FR-010a**: Deleting a Customer or a Product that is still referenced MUST be refused, on the
  same grounds as FR-007. A cascade would remove orders, and therefore financial history, as a
  side effect of a catalog edit.
- **FR-010b**: The same Product MAY appear on more than one Order Line Item within the same
  Order. No uniqueness constraint MUST span the Order and Product references. Quantity is a
  property of a line, not of a product within an order, and collapsing repeated products into one
  line is order-creation behaviour that this specification excludes.

**Monetary values**

- **FR-011**: Every monetary value MUST be stored as a whole number of the currency's minor
  unit, on a column whose declared type is integer, per Constitution Principle IV.
- **FR-012**: Monetary columns MUST NOT carry a real or numeric affinity, and monetary values
  MUST NOT be produced by floating point arithmetic.
- **FR-013**: The database MUST reject a write that places a non-integer value in a monetary
  column, rather than coercing it.
- **FR-014**: Each Order Line Item MUST store the unit price captured at the moment the order
  was placed, and MUST NOT depend on the current catalog price for any historical read.
- **FR-015**: A captured unit price MUST be zero or greater. Negative unit prices MUST be
  rejected.
- **FR-016**: Each Order Line Item MUST store a quantity of at least one. Zero and negative
  quantities MUST be rejected.
- **FR-017**: The line total for an Order Line Item MUST equal its captured unit price
  multiplied by its quantity, and that equality MUST be guaranteed by the database rather than
  by a convention the write path is trusted to follow.
- **FR-018**: The Order MUST NOT store a total. The order total is derived as the sum of its line
  totals, in the same minor unit, at the point of use. A stored total would be an
  application-level guarantee rather than a database one, because a check constraint admits no
  subquery and a row trigger cannot validate a multi-row sum while lines are still being
  inserted. Since the two-phase read in Constitution Principle V already fetches the line items
  for every order on a page, the sum is available without an additional query.
- **FR-019**: Every stored monetary value MUST be constrained to the inclusive range 0 through
  9,007,199,254,740,991, which is 2^53 - 1, the largest integer the application runtime
  represents exactly. A write outside that range MUST be rejected rather than stored and later
  read back inexactly. The storage type holds wider values than this, so the bound MUST be
  expressed as a constraint on each monetary column and MUST NOT be assumed from the column type.
- **FR-019a**: The derived order total of FR-018 is the one monetary value no column constraint
  can bound, because it is a sum whose term count is not known in advance and two conforming line
  totals can exceed the FR-019 ceiling between them. The derivation MUST therefore be exact or
  MUST fail loudly, and MUST NOT return a value that has silently lost precision. This is the
  cost of deriving rather than storing the total, and it is paid at the point of derivation.
- **FR-020**: Tables in this specification MUST NOT carry a currency code column or any structure
  anticipating multi-currency support, per the constitution's scope constraints. Every monetary
  value is denominated in the single currency's minor unit, and nothing records which currency
  that is.

**Immutability of history**

- **FR-021**: An update to an Order Line Item's captured unit price MUST be aborted by the
  database itself, not by an application-layer guard or an ORM-level convention.
- **FR-022**: An update to an Order Line Item's quantity MUST be aborted on the same terms,
  because line total is a function of quantity, so a mutable quantity rewrites financial history
  exactly as effectively as a mutable price.
- **FR-023**: An update to an Order Line Item's Order reference, or to its captured product
  reference and product description, MUST be aborted on the same terms.
- **FR-024**: An update to an Order's creation timestamp MUST be aborted by the database.
- **FR-025**: Each Order Line Item MUST store a human-readable description of the product as it
  was at the moment the order was placed, subject to the same immutability as the captured
  price, so a historical order can be rendered without joining a catalog whose values have since
  changed.
- **FR-025a**: Deleting a stored Order Line Item MUST be aborted by the database, on the same
  terms as the update rules above. An update and a deletion rewrite financial history equally
  well, and a rule covering only one of them protects nothing that the other cannot reach.
- **FR-025b**: A stored Order is consequently undeletable. It always has at least one line item
  by FR-008, that line item cannot be removed by FR-025a, and FR-007 refuses to delete an Order
  while any line item references it. A separate deletion rule on Order MUST NOT be added, because
  a second guard for a guarantee that already holds is a thing to keep in sync for no gain.
- **FR-025c**: Because these tables refuse row deletion, test isolation for them MUST be achieved
  by rebuilding the tables rather than by clearing rows. The observable requirement is unchanged
  from Spec 001's SC-005: every test MUST produce the same outcome run alone as it does in the
  full suite, and no test's assertions MUST depend on rows another test created. Choosing the
  rebuild granularity is a planning decision, constrained by that guarantee.
- **FR-025d**: FR-025c deviates from Constitution Principle VI, which names `DELETE FROM` in
  `beforeEach` as the isolation mechanism. The deviation MUST be recorded with its justification
  in the Complexity Tracking section of the implementation plan before any code is merged, per
  the constitution's Development Workflow section. It MUST NOT be resolved by weakening FR-025a.

**Status**

- **FR-026**: The Order MUST carry a status field whose permitted values are a closed,
  documented set, and the database MUST reject any value outside it.
- **FR-027**: The permitted status values MUST be exactly `pending`, `processing`, and
  `cancelled`. The set is deliberately limited to values something in the declared scope reaches:
  `pending` on creation, `processing` from the background promotion job in Constitution Principle
  III, and `cancelled` from the cancellation path a later specification adds. Fulfilment statuses
  are excluded because no code path in scope writes them, and a permitted value nothing can
  produce is indistinguishable at read time from one the state machine has lost the ability to
  reach. Adding a value later is a migration and a state machine change, which is the correct
  cost for widening the lifecycle.
- **FR-028**: A newly created Order MUST take `pending` as its status, and that default MUST be
  applied by the database rather than relying on every write path to supply it.
- **FR-029**: The status field MUST support a conditional update that names both the Order's
  identity and its expected current status, reporting exactly one changed row when the expected
  status matches and zero when it does not, per Constitution Principle II.
- **FR-030**: The status field MUST NOT encode any transition rule, ordering, or precedence. It
  records the current value only. Legal transitions belong to the centralized state machine
  defined in a later specification, per Constitution Principle I.

**Timestamps**

- **FR-031**: Every timestamp MUST be stored as an integer count of microseconds since the Unix
  epoch, per Constitution Principle V. Text representations and real-valued julian day numbers
  MUST NOT be used on any timestamp column.
- **FR-032**: The Order MUST record when it was created, and that value MUST be the column that
  participates in ordering and in keyset cursors.
- **FR-033**: The Order MUST record when it last changed, so a reader can distinguish an order
  that has moved through the lifecycle from one that has not.
- **FR-034**: Both Order timestamps MUST be required, MUST be greater than zero, and the
  last-changed value MUST NOT precede the creation value.
- **FR-034a**: The last-changed timestamp MUST be maintained by the database on every update to
  an Order row, not by the write paths that issue those updates. No caller can then leave it
  stale, and the conditional status update keeps the exact shape Constitution Principle II
  mandates rather than growing a timestamp assignment that principle does not describe.
- **FR-034b**: Maintaining that timestamp MUST NOT alter the changed-row count the caller
  observes for its own statement. Constitution Principle II decides the 409 response from that
  count, so anything that inflates it turns a conflict into a false success.
- **FR-035**: An Order Line Item MUST NOT carry its own creation timestamp. It is written inside
  the transaction that creates its Order and is immutable thereafter, so its Order's creation
  timestamp is its creation timestamp, and a second copy could only ever disagree.

**Access patterns and indexes**

- **FR-036**: Paging orders by creation time with a unique tiebreaker MUST be satisfiable from
  an index, without scanning the orders table. This is the read path Constitution Principle V
  requires.
- **FR-037**: Selecting the oldest orders in a given status under a row limit MUST be satisfiable
  from an index, without scanning the orders table. This is the bounded claim Constitution
  Principle III requires, and an unindexed version of it holds the single write lock for the
  duration of a full scan.
- **FR-038**: Fetching all Order Line Items for a set of Order identifiers MUST be satisfiable
  from an index, without scanning the line items table. This is the second query of the two-phase
  read in Constitution Principle V.
- **FR-039**: Every index the model defines MUST be traceable to one of the access patterns named
  above. Indexes MUST NOT be added for access patterns this specification does not commit to,
  because each one is a write-time cost paid on every insert.
- **FR-039a**: The customer reference on Order and the product reference on Order Line Item MUST
  NOT be indexed. Enforcing the deletion restriction in FR-010a therefore scans the referencing
  table, which is accepted because deleting a customer or a product is not an access pattern this
  specification commits to and the placeholder tables of FR-001a are not expected to survive.
  Listing an individual customer's orders is likewise not in scope. Should either become a real
  access pattern, the index follows it rather than preceding it.

**Schema management**

- **FR-040**: The schema MUST be defined in committed source that is the single source of truth,
  and every change MUST ship with a generated, versioned, committed migration, per the
  constitution's technical constraints and Spec 001's FR-010 through FR-012.
- **FR-041**: Applying the migrations to an empty database MUST produce the complete model,
  including all constraints, defaults, triggers, and indexes, with no manual step afterwards.
- **FR-042**: Every constraint, trigger, and index this specification requires MUST be verified by
  a test that exercises the failure mode it prevents, against a real database, per Constitution
  Principle VI. A test asserting only that a valid row can be written is not evidence that an
  invalid one is refused.

### Key Entities

- **Order**: A customer's purchase, recorded once and thereafter changed only through its status
  and its last-changed timestamp. Holds its own identifier, a required reference to its Customer,
  its current lifecycle status, and the microsecond timestamps for creation and last change. It
  holds no total; the total is the sum of its line totals, computed where it is needed. Its
  creation timestamp plus its identifier form the totally ordered key that paging depends on.
- **Order Line Item**: One product line within an Order, and the financial record of what was
  charged for it. Holds its own identifier, a required reference to its Order, a required
  reference to its Product, the product description captured at the time of the order, the unit
  price captured at the time of the order, the quantity, and the line total that must equal price
  multiplied by quantity. Immutable once written.
- **Customer** (placeholder): The party an Order belongs to. An identifier and a display name,
  and nothing else. It exists in this specification only so the Order's foreign key is real and
  its enforcement is testable. Owned by no specification yet.
- **Product** (placeholder): The catalog entry an Order Line Item was placed for. An identifier, a
  display name, and a current unit price in minor units. The price is present so that changing it
  demonstrates the captured price on a historical line item does not follow it. Owned by no
  specification yet.
- **Order Status**: The closed set `pending`, `processing`, `cancelled`, with `pending` as the
  value a new Order takes. This specification fixes the set and the default. The legal transitions
  between the values belong to the state machine in a later specification.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of writes that violate a stated invariant are refused by the database. No
  invariant in this specification is enforced only by application code, except FR-008, which
  names its enforcement point explicitly and gives the reason it cannot be a table constraint.
- **SC-002**: Round-tripping an order and its line items returns every field byte-identical to
  what was written, across 100% of fields, with zero type coercions observed.
- **SC-003**: Monetary arithmetic produces the exact expected integer in 100% of cases across a
  test set that includes zero, one minor unit, 2^53 - 1, and the first value above it. Writes at
  or below the ceiling are accepted and writes above it are rejected, with no case where a value
  is accepted and reads back changed.
- **SC-004**: 100% of attempts to modify a stored line item's price or quantity are aborted, and
  the stored row is unchanged afterwards in every case.
- **SC-004a**: 100% of attempts to delete a stored line item are aborted, and no sequence of
  statements available to a caller removes a stored order from the database.
- **SC-005**: 100% of attempts to store a status outside the permitted set are refused.
- **SC-006**: A conditional status update reports exactly one changed row when the expected
  status matches, and exactly zero when it does not, in 100% of attempts, with no third outcome.
  The count is unaffected by the timestamp maintenance in FR-034a.
- **SC-006a**: 100% of updates that change an order row set its last-changed timestamp to the
  moment of that update, with no write path exempt and no case where it moves backwards. 0% of
  them alter the creation timestamp. Updates separated by more than one microsecond are observed
  to advance it strictly.
- **SC-007**: Each of the three committed access patterns executes without a full scan of a
  domain table, verified against a table populated with at least 10,000 orders.
- **SC-008**: Paging the full order set with a keyset cursor returns every order exactly once,
  with zero duplicates and zero omissions, including across orders sharing a creation timestamp.
- **SC-009**: Applying the migrations to an empty database reproduces the complete model in a
  single command, with an identical result on every machine, and re-running it makes no further
  change.
- **SC-010**: Every constraint, trigger, and index required here has at least one test that fails
  if the guarantee is removed. Deleting any single one from the schema turns the suite red.

## Assumptions

These are the defaults chosen where the description did not specify. The ones most likely to
warrant challenge are marked as load-bearing.

- **Load-bearing**: This specification creates placeholder Customer and Product tables, which
  reverses the feature description's instruction to treat those entities as existing and define
  nothing about them. The instruction assumed a repository where those tables are already
  present. This one has none, and the connection enforces foreign keys, so the alternatives were
  an unconstrained column that proves nothing about referential integrity or a declared reference
  to a missing table that fails every insert. FR-001a keeps the placeholders as thin as the
  foreign keys allow, and marks them for replacement rather than extension. If they are still
  present unchanged when a real customer or catalog specification lands, that is the signal this
  assumption was wrong.
- **Load-bearing**: The Order Line Item captures the product's description as well as its price.
  The constitution mandates price capture explicitly and is silent on description, but the
  rationale it gives, that catalog values drift and history must not follow them, applies to the
  description identically. A historical order that cannot be rendered without joining a mutated
  catalog is only partly immutable.
- **Load-bearing**: Orders and their line items are permanent once written, and the test suite
  pays for that by rebuilding these tables instead of clearing them. The alternative was to leave
  deletion open so the existing isolation mechanism kept working, which would have meant the
  immutability guarantee stopped at the one verb a caller is most likely to reach for when they
  want history gone. The cost lands on test setup time and on a recorded deviation from
  Constitution Principle VI, not on the guarantee.
- **Load-bearing**: Quantity is immutable along with price. The constitution names only the
  captured price, but line total is price multiplied by quantity, so leaving quantity mutable
  would leave the guarantee it describes reachable by another route.
- **Load-bearing**: Order identifiers are sequential integers, which is what the constitution's
  own example statements assume. Sequential identifiers are externally enumerable and leak order
  volume to anyone who can see one. That is accepted here because the service is unauthenticated
  and local-scope by Spec 001's assumptions, and an opaque public identifier is the change to
  make if that scope ever widens.
- The system operates in a single country with a single currency, so no currency code is stored
  anywhere, per the constitution's scope constraints.
- The placeholder Customer and Product tables use the same identifier shape as Order and Order
  Line Item, so every table in the model is keyed the same way. A product code or similar natural
  key was not adopted, because choosing one is a decision for the specification that eventually
  owns the catalog, and FR-001a already marks these tables for replacement.
- The volume this model is designed against is the ten thousand orders SC-007 verifies the index
  behaviour at. Nothing in the declared scope establishes a real expected volume, and the figure
  is chosen to be large enough that a full scan is distinguishable from an index seek rather than
  as a capacity claim.
- Order Line Items within an Order are ordered deterministically by their own primary key, which
  reflects insertion order. No separate line number or sequence column is stored, because the key
  already provides the total order that rendering needs.
- Orders are never hard deleted in normal operation. No soft-delete flag or deletion timestamp is
  stored, because nothing in the declared scope deletes an order, and a column with no writer is
  a column that will be wrong when one appears.
- Shipping addresses, billing details, payment records, discounts, taxes, and fulfilment data are
  out of scope. They are absent rather than stubbed, because a nullable placeholder column is
  indistinguishable from an unimplemented feature at read time.
- Idempotency keys and duplicate-submission handling are deferred with order creation, which the
  feature description places out of scope.
- The order total is exactly the sum of its line totals, in the same minor unit. No adjustment,
  rounding, or fee component exists to reconcile, because none of those concepts are in scope. If
  one arrives, a stored total becomes worth revisiting, since the sum would no longer be
  derivable from the lines alone.
- The status set is closed at three values, so an order that has been paid for or shipped is
  indistinguishable from one that is merely being processed. That is accepted because fulfilment
  is out of scope, and it is the first thing to revisit when it is not.
- The write path that creates orders, the read paths that fetch and page them, the state machine
  that governs transitions, and the background job that promotes them are all deferred to later
  specifications. This specification defines only what their storage guarantees.

# Feature Specification: Fix Scheduler Processing Loop

**Feature Branch**: `005-fix-scheduler-loop`

**Created**: 2026-09-05

**Status**: Draft

**Input**: User description: "Fix Scheduler Processing Loop. The background scheduler currently uses a
maximum iteration count as the normal stopping condition, so it performs unnecessary iterations when
there is no more work. Change the processing behavior so that: the scheduler continues processing
while eligible work is available; the current batch result determines whether processing should
continue; an empty batch terminates the current scheduler run naturally; a maximum iteration limit
remains as a hard safety guard against runaway processing; the scheduler remains bounded and must
never become an unbounded loop; and existing concurrency, atomicity, failure handling, and
observability guarantees are preserved. Do not change the business behavior of order processing
beyond correcting the scheduler loop termination behavior."

## Problem

The background job that promotes waiting orders processes them in batches. Its loop is governed by
the iteration limit: the limit is what the loop asks before each pass, and the state of the work
queue is consulted only afterwards, as a secondary exit.

Because of that ordering, the run cannot conclude from a batch that the queue is drained. It can only
conclude it from a batch that returns **nothing**. A run that asks for a batch of one hundred and
receives five has already proved there is no sixth order waiting, and it still performs another claim
against the queue to be told so.

That extra claim is not free and not read-only. It takes the same write path every other batch takes,
against a store that admits one writer at a time, and it blocks the run for its duration. The
service's default cadence means a system with an empty or short queue pays this cost on every run,
indefinitely, in exchange for information it already had.

The observable symptoms today:

| Waiting orders | Batch size | Claims performed | Claims that did any work |
| ---: | ---: | ---: | ---: |
| 0 | 100 | 1 | 0 |
| 5 | 100 | 2 | 1 |
| 100 | 100 | 2 | 1 |
| 5,000 | 100 | 10 (the limit) | 10 |

Rows two and three are the defect. Row three is not: a batch that comes back full is no evidence the
queue is empty, so a further claim is genuinely required there. Row four is correct and must not
change.

The correction inverts the two conditions. Whether work remains becomes the loop's own question, and
the iteration limit steps back to being what its name has always claimed: a guard against a run that
will not end, rather than the thing that ends every run.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A run ends when the work does (Priority: P1)

An operator runs the service against a queue that is empty, or holds fewer orders than one batch. The
run claims what is there, recognises from that batch that nothing remains, and finishes. It does not
perform a further claim to confirm what the batch already told it.

**Why this priority**: this is the defect. Every other story in this specification protects a
guarantee that already holds; this one is the only change in behaviour anybody asked for, and it is
independently valuable — a service whose queue is usually empty stops taking the write path once per
cycle for nothing.

**Independent Test**: seed a queue smaller than one batch, invoke one run directly, and count the
claims it performed. It must be one.

**Acceptance Scenarios**:

1. **Given** an empty queue, **When** one run executes, **Then** it performs exactly one claim, promotes nothing, and ends without reaching the iteration limit.
2. **Given** a queue holding fewer orders than one batch, **When** one run executes, **Then** it performs exactly one claim, promotes every order in the queue, and ends.
3. **Given** a queue holding exactly one batch, **When** one run executes, **Then** it performs a second claim, because a full batch is not evidence that the queue is empty, and ends when that second claim returns nothing.
4. **Given** a queue holding several full batches and fewer than the limit allows, **When** one run executes, **Then** it performs one claim per full batch plus one final claim, and ends on the batch that comes back short or empty.

---

### User Story 2 - The limit still stops a runaway run (Priority: P2)

An operator faces a queue that is being refilled as fast as it is drained. The run must still stop.
The iteration limit is no longer the ordinary way a run ends, and it must still be the way a run that
would otherwise never end does end.

**Why this priority**: this is the risk the change introduces. Moving the limit out of the loop
condition is exactly the edit that turns a bounded loop into an unbounded one if it is done
carelessly, and the failure mode — a run that holds the single write path indefinitely and blocks the
service — is severe. It is P2 rather than P1 only because it preserves rather than adds.

**Independent Test**: seed a queue far larger than batch size times the limit, invoke one run, and
confirm it performs exactly the limit's worth of claims and no more, promoting exactly the same
number of orders it promotes today.

**Acceptance Scenarios**:

1. **Given** a queue larger than batch size times the limit, **When** one run executes, **Then** it performs exactly the limit's number of claims, promotes exactly batch size times the limit, and reports that the limit was reached.
2. **Given** the same queue, **When** successive runs execute, **Then** the remainder drains across runs, with no order lost, skipped, or promoted twice.
3. **Given** a limit configured to one, **When** one run executes against a large queue, **Then** it performs exactly one claim and stops.
4. **Given** any queue state whatsoever, including one refilled between every batch, **When** one run executes, **Then** the number of claims it performs never exceeds the configured limit.

---

### User Story 3 - Nothing else about order processing changed (Priority: P3)

An operator upgrades and observes that which orders are promoted, in what order, under what
protections, and what the service reports about it, are all exactly as before.

**Why this priority**: the instruction is explicit that business behaviour must not change beyond the
loop's termination. This story is the evidence for that claim rather than a change in its own right,
so it is last — but a failure here would make the other two worthless.

**Independent Test**: run the complete pre-existing test suite unchanged, except for the three
iteration-count expectations this specification deliberately supersedes, and confirm it passes.

**Acceptance Scenarios**:

1. **Given** a queue containing both waiting and cancelled orders, **When** runs execute, **Then** no cancelled order is ever promoted, exactly as before.
2. **Given** a queue of orders created at different times, **When** a run executes, **Then** the oldest are claimed first, exactly as before.
3. **Given** a batch that fails part-way through a run, **When** the failure occurs, **Then** already-committed batches stay committed, the run ends, the failure is recorded, and the process does not crash — exactly as before.
4. **Given** a run still executing when the next is due, **When** the next is due, **Then** it is skipped and the skip is recorded, exactly as before.
5. **Given** shutdown has begun, **When** a run would start, **Then** it does not, and an in-flight run finishes within the existing drain window, exactly as before.

---

### Edge Cases

- **A batch comes back short while eligible work remains.** Measured during planning: this cannot happen from a competing writer. One batch is a single statement inside a single transaction on a store that serialises writers, so nothing can change the queue while that statement runs, and a short batch means fewer than a full batch of eligible orders existed at that moment. Spec 003 assumed otherwise and paid a claim per run for the assumption; research R1 records the measurement.
- **Work arrives after the run has decided to stop.** The only way work outlives a short batch. The next run takes it, and this is already true today of a run that stops on an empty batch, so it is not a risk this change introduces.
- **The queue holds exactly a whole number of batches.** The final full batch cannot end the run, so one further claim is performed and returns nothing. This is correct, not a residue of the defect.
- **The batch size is configured to one.** Every batch is either full or empty, so the run behaves as it does today: it continues until a claim returns nothing or the limit intervenes.
- **The limit is configured to one.** Exactly one claim is performed regardless of the queue, and the run reports that the limit was reached.
- **A batch claims more rows than were requested.** Impossible by construction, but if observed it must be treated as a full batch rather than as a signal to continue indefinitely.
- **The very first claim of a run fails.** The run ends, having promoted nothing, and the failure is recorded. It is not retried within the same run.

## Requirements *(mandatory)*

### Functional Requirements

#### Loop termination

- **FR-001**: A scheduler run MUST continue claiming batches while the evidence available to it indicates that eligible work remains.
- **FR-002**: The result of the batch just claimed MUST be what decides whether the run continues. The iteration count MUST NOT be the condition that ordinarily ends a run.
- **FR-003**: A batch that claims nothing MUST end the run.
- **FR-004**: A batch that claims fewer orders than the configured batch size MUST end the run, because no eligible order remained to fill it. The run MUST NOT perform a further claim to confirm this.
- **FR-005**: A batch that claims the full configured batch size MUST NOT end the run. A full batch is not evidence that the queue is exhausted, and the run MUST continue unless the safety guard stops it.
- **FR-006**: A run against an empty queue MUST perform exactly one claim.

#### The safety guard

- **FR-007**: The maximum iteration limit MUST remain enforced, MUST remain configurable, MUST remain positive, and MUST retain its current default.
- **FR-008**: The limit MUST bound the number of claims a single run may perform, under every queue state, including a queue refilled between every batch.
- **FR-009**: Reaching the limit MUST end the run and leave the remaining queue for the next one, exactly as it does today.
- **FR-010**: The run MUST NOT be capable of becoming an unbounded loop. Termination MUST NOT depend on the queue eventually being empty.
- **FR-011**: Against a queue larger than batch size times the limit, one run MUST promote exactly batch size times the limit orders and MUST leave the remainder waiting. This is unchanged and MUST NOT regress.

#### Preserved guarantees

- **FR-012**: Each batch MUST continue to claim its orders by selecting a capped set of identifiers and updating exactly those, with the expected status re-asserted in the outer predicate, in the shape the constitution mandates.
- **FR-013**: Each batch MUST continue to commit in its own transaction. No write transaction may span more than one batch or a whole run.
- **FR-014**: Orders MUST continue to be claimed oldest first.
- **FR-015**: A cancelled order MUST continue never to be promoted, with the exclusion coming from the claiming statement's own predicate rather than from a filter applied after reading.
- **FR-016**: The target status MUST continue to be obtained from the state machine rather than written as a literal.
- **FR-017**: Runs MUST continue not to overlap, and a skipped run MUST continue to be recorded.
- **FR-018**: Shutdown behaviour MUST be unchanged: no new run begins once shutdown has started, and an in-flight run finishes within the existing drain window.
- **FR-019**: A failure part-way through a run MUST continue to leave committed batches committed, end the run, be recorded, and not crash the process.
- **FR-020**: A run MUST remain directly invocable so its behaviour can be exercised without waiting for the schedule.
- **FR-021**: No order's eligibility, ordering, target status, or promotion count per run may change as a result of this specification, other than the count arising from a run that now stops earlier against a short queue.

#### Observability

- **FR-022**: The per-run structured record MUST continue to carry the number of iterations performed, the number of orders promoted, whether the limit was reached, and the elapsed duration. No existing field may be removed or renamed.
- **FR-023**: The reason a run ended MUST be distinguishable from the record alone: exhausted work, the safety guard, or a failure. Distinguishing these MUST NOT require correlating separate records or inferring from field arithmetic.
- **FR-024**: The recorded iteration count MUST report claims actually performed, so the reduction this specification delivers is visible rather than merely believed.

#### Verification

- **FR-025**: Every requirement above MUST be exercised against a real database through the real assembled application, with no mocked persistence.
- **FR-026**: Tests MUST NOT depend on elapsed wall-clock time to observe scheduled behaviour.
- **FR-027**: The claim count of a run MUST be asserted directly rather than inferred from the number of orders promoted, since the defect is invisible in the promotion count.
- **FR-028**: The entire pre-existing test suite MUST pass without modification, with exactly three permitted exceptions, each an iteration-count assertion that this change deliberately reduces, and each named in the implementation plan:
  - `promotion.bounded.spec.ts`, "ends early when the backlog runs out": 2 claims becomes 1.
  - `promotion.claim.spec.ts`, "commits each chunk separately rather than holding one transaction": 5 claims becomes 4.
  - `promotion.lifecycle.spec.ts`, "records what each tick did": 3 claims becomes 2.

  In all three the number of orders promoted MUST be unchanged. Two of them also carry explanatory comments asserting that a short chunk is not evidence of an empty backlog, which this specification reverses; those comments MUST be rewritten rather than left contradicting the code. Any *other* test requiring an edit MUST be treated as evidence of an unintended behaviour change rather than as a test needing adjustment.
- **FR-029**: Removing the safety guard MUST turn the test suite red, and so MUST removing the short-batch termination. A guarantee whose removal leaves the suite green has no test behind it.

### Key Entities

- **Scheduler run**: one execution of the background promotion job. Holds an iteration count, a promoted count, whether the guard was reached, an elapsed duration, and — newly — why it ended.
- **Batch claim**: one bounded attempt to move a capped set of waiting orders to processing, committed on its own. Its result is a count of orders actually moved, which is the signal this specification promotes to the loop's decision.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A run against an empty queue performs exactly one claim. Today it performs one; this must not regress.
- **SC-002**: A run against a queue holding fewer orders than one batch performs exactly one claim. Today it performs two.
- **SC-003**: Against a queue holding between one order and one order fewer than a full batch, the claims a run performs fall from two to one, a 50% reduction, measured from the recorded iteration count rather than estimated.
- **SC-004**: A run against a queue larger than batch size times the limit promotes exactly batch size times the limit orders — the same number as today, to the order.
- **SC-005**: Under every queue state tested, including a queue refilled between every batch, the number of claims a single run performs never exceeds the configured limit.
- **SC-006**: Every run terminates. No test, and no manual exercise, produces a run that does not end.
- **SC-007**: Which orders are promoted, and in what order, is identical before and after the change for every tested queue state.
- **SC-008**: The complete pre-existing test suite passes with exactly three changed expectations, the ones FR-028 names, each a reduced claim count with an unchanged promotion count.
- **SC-009**: Removing the safety guard turns the suite red, and removing short-batch termination turns the suite red.
- **SC-010**: The reason a run ended can be read from a single structured record, for all three reasons, without correlating records.
- **SC-011**: No migration is generated, and no schema change is pending, because this specification touches no stored data.

## Assumptions

- **The premise as stated is directionally right but not literally accurate, and this specification corrects it rather than repeating it.** The job already ends a run when a batch claims nothing; that exit exists today. What it does not do is treat a *short* batch as the same signal, so the wasted claim occurs after a partial batch rather than on every run up to the limit. The correction requested — batch result decides continuation, limit becomes a guard — is exactly right; the cost being removed is one claim per run against a short queue, not the several the description implies. This is recorded here so the plan is built against the real defect.
- Ending a run on a short batch may leave work that arrives *after* that batch for the next run. This is accepted: the delay is bounded by one cycle, no work is lost, and it is already true of a run that stops on an empty batch today. What planning established (research R1) is that a competing writer cannot shorten a batch, so this is the only residual case rather than one of two.
- The default batch size and iteration limit are unchanged. This specification changes when a run stops, not how much it may do.
- The scheduling cadence, the overlap guard, and the shutdown drain are untouched.
- No new configuration setting is introduced.
- The single-writer storage engine and single-process deployment stance are unchanged, and remain the reason the claim count matters at all.
- Adding a field to the per-run record is additive. FR-022 forbids removing or renaming an existing field, so consumers of that record are unaffected.
- This specification supersedes Spec 003's FR-085 ("a run MUST also end when an iteration claims zero rows") by widening it: ending on zero remains required, and ending on a short batch is added. Spec 003's FR-084 and FR-087 are preserved verbatim in FR-007 and FR-011.

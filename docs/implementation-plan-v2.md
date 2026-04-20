# Hindsight-pi Implementation Plan v2

Status: proposed
Depends on: `docs/architecture-v2.md`

## Objective

Implement architecture v2 in controlled phases so `hindsight-pi` becomes stable enough for broader publication and eventual official-hub donation.

## Delivery strategy

Principles:
- freeze target architecture before major code churn
- land foundation before UX cleanup
- keep migration path from current behavior
- expand tests as each phase lands
- avoid reworking docs until behavior stabilizes

## Phase 0 — freeze architecture and track work

Goal:
- establish agreed target
- create durable progress tracking
- reduce behavior churn

Tasks:
- [ ] Review and approve `docs/architecture-v2.md`
- [ ] Review and approve this implementation plan
- [ ] Decide unresolved questions listed in architecture doc
- [ ] Mark deprecated architecture pieces in notes/comments
- [ ] Create branch strategy for v2 work

Deliverables:
- approved architecture doc
- approved implementation plan
- agreed defaults and approved decisions recorded

Risks:
- coding starts before architecture decisions settle

## Phase 1 — session identity foundation

Goal:
- create canonical session identity and document identity

Tasks:
- [ ] Add `SessionIdentity` type
- [ ] Generate stable `sessionId` at session start
- [ ] Generate stable `sessionDocumentId`
- [ ] Capture workspace/repo metadata
- [ ] Capture parent/fork metadata if available
- [ ] Expose runtime getters for active session identity
- [ ] Preserve deterministic workspace naming UX

Files likely touched:
- `extensions/session.ts`
- `extensions/index.ts`
- maybe `extensions/hooks.ts`

Deliverables:
- `getSessionIdentity()`
- `deriveSessionDocumentId()`
- active runtime session identity state

Tests:
- [ ] session ID generated once per session
- [ ] document ID stable for session lifecycle
- [ ] manual bank behavior still respected
- [ ] session naming does not regress to bank-ID naming

## Phase 2 — structured retain serializer

Goal:
- replace plaintext primary retain payload with structured JSON records

Tasks:
- [ ] Define `SessionAppendRecord`
- [ ] Build serializer for turn records
- [ ] Build serializer for session event records
- [ ] Add schema versioning
- [ ] Sanitize secrets in structured fields
- [ ] Strip injected memory/reasoning/base64 noise
- [ ] Summarize or filter tool-call noise
- [ ] Attach auto-tags and metadata
- [ ] Keep legacy serializer only if needed for migration/testing

Files likely touched:
- `extensions/upload.ts`
- or split into `extensions/retain/*`

Deliverables:
- `serializeTurnRecord(...)`
- `serializeSessionEvent(...)`
- structured payload tests

Tests:
- [ ] structured JSON record shape valid
- [ ] secrets redacted
- [ ] injected memory stripped
- [ ] tags attached
- [ ] trivial prompt skip still works
- [ ] opt-out handling still works

## Phase 3 — durable local queue

Goal:
- ensure retain survives restart/offline/server failure

Tasks:
- [ ] Choose queue storage path/layout
- [ ] Implement append-only queue item persistence
- [ ] Implement queue load on startup
- [ ] Implement replay on reconnect/startup
- [ ] Implement ack marking
- [ ] Implement compaction for acked items
- [ ] Add retry/backoff rules
- [ ] Add queue stats helpers
- [ ] Integrate queue with retain scheduler

Files likely touched:
- `extensions/queue.ts` (new)
- `extensions/upload.ts`
- `extensions/index.ts`
- `extensions/commands.ts`

Deliverables:
- `enqueueWrite(...)`
- `replayQueue()`
- `flushQueue()`
- `getQueueStatus()`

Tests:
- [ ] queue item persisted to disk
- [ ] startup replay sends pending items
- [ ] acked items compact correctly
- [ ] restart simulation does not lose writes
- [ ] duplicate replay handling acceptable/idempotent

## Phase 4 — fresh recall redesign

Goal:
- remove session-level cached recall anti-pattern

Tasks:
- [ ] Replace session cached recall blob with per-turn recall fetch
- [ ] Derive recall query from current user message
- [ ] Add normalization/meaningful-message extraction
- [ ] Handle short prompts like `continue`
- [ ] Keep grouped/unified rendering
- [ ] Keep first-turn injection option
- [ ] Keep tools-only mode
- [ ] Add optional identical-request micro-cache only if justified
- [ ] Remove obsolete TTL/cadence refresh behavior from runtime
- [ ] Ensure recalled memory is never re-retained

Files likely touched:
- `extensions/context.ts` or replacement files
- `extensions/index.ts`
- `extensions/config.ts`

Deliverables:
- `buildRecallRequest(...)`
- `fetchRecallForTurn(...)`
- `renderRecallBlock(...)`

Tests:
- [ ] different prompt => fresh recall call
- [ ] grouped rendering correct
- [ ] unified rendering correct
- [ ] first-turn only respected
- [ ] tools mode avoids auto injection
- [ ] no stale session cache behavior remains

## Phase 5 — Hindsight append transport

Goal:
- persist structured records using stable session document append semantics

Tasks:
- [ ] Validate preferred Hindsight append pattern with client/API
- [ ] Implement stable `document_id` usage
- [ ] Implement append operation abstraction
- [ ] Ensure timestamps/context/session metadata align with Hindsight expectations
- [ ] Support fallback if API/client capabilities differ
- [ ] Reuse official client where possible

Files likely touched:
- `extensions/client.ts`
- `extensions/upload.ts`

Deliverables:
- `appendSessionRecord(bankId, documentId, record)`
- `ensureSessionDocument(...)` if needed

Tests:
- [ ] stable document ID reused
- [ ] append payload shape valid
- [ ] retry path works through queue replay

Open dependency:
- this phase should be reviewed against Hindsight best practices before finalization

## Phase 6 — config simplification + migration

Goal:
- align config surface with v2 architecture

Tasks:
- [ ] Deprecate/remove recall cache knobs if obsolete
- [ ] Review/remap `contextCadence`
- [ ] Review/remap `contextRefreshTtlSeconds`
- [ ] Review/remap `contextRefreshMessageThreshold`
- [ ] Keep global/project support
- [ ] Keep explicit save-scope UX
- [ ] Hide experimental linked-host config from normal settings
- [ ] Add migration path for old config fields
- [ ] Surface deprecation info in diagnostics if needed

Files likely touched:
- `extensions/config.ts`
- `extensions/commands.ts`
- `README.md`

Deliverables:
- simplified config shape
- migration notes
- deprecation handling

Tests:
- [ ] old config still resolves safely
- [ ] project/global precedence still correct
- [ ] save flow does not recreate removed fields
- [ ] no surprise localhost injection regression

## Phase 7 — retain semantics finalization

Goal:
- make user-facing labels and transport state perfectly aligned

Tasks:
- [ ] Define exact state machine for `turn`
- [ ] Define exact state machine for `async`
- [ ] Define exact state machine for `session`
- [ ] Define exact state machine for numeric batch
- [ ] Reassess `step-batch` and `both` semantics under session-append model
- [ ] Keep advanced retain modes behind advanced settings if retained
- [ ] Finalize wording for queued/saved/skipped states

Files likely touched:
- `extensions/upload.ts`
- `extensions/index.ts`
- `README.md`

Deliverables:
- final retain state model
- stable indicator wording

Tests:
- [ ] `turn` saves immediately
- [ ] `async` queues then confirms later
- [ ] `session` queues until flush/end
- [ ] numeric batch queues until threshold then flushes
- [ ] skip message only shown when truly skipped

## Phase 8 — diagnostics and operator commands

Goal:
- improve maintainability and trust during live use

Tasks:
- [ ] Expand `/hindsight:doctor` with queue/session-document info
- [ ] Expand `/hindsight:where` with deprecated field visibility if needed
- [ ] Consider `/hindsight:flush`
- [ ] Consider `/hindsight:queue`
- [ ] Keep `/hindsight:status` compact but useful

Files likely touched:
- `extensions/commands.ts`

Deliverables:
- stronger diagnostics
- queue visibility
- flush path if implemented

Tests:
- [ ] doctor output stable and useful
- [ ] queue status shown correctly
- [ ] config source reporting still correct

## Phase 9 — docs and rationale pack

Goal:
- document design cleanly for users and maintainers

Tasks:
- [ ] Write `docs/best-practices.md`
- [ ] Update README for v2 behavior
- [ ] Add migration notes from v1 behavior
- [ ] Document why recall is fresh-per-turn
- [ ] Document why session append is primary durable model
- [ ] Document why indicators are UI-only by default
- [ ] Document advanced/experimental features separately

Files likely touched:
- `README.md`
- `docs/architecture-v2.md`
- `docs/best-practices.md`
- `docs/config.md`
- `docs/commands-and-tools.md`

Deliverables:
- public-ready docs
- maintainer-facing rationale

Tests/checks:
- [ ] docs match runtime behavior
- [ ] publish examples work

## Recommended work order

Order:
1. Phase 0 — freeze decisions
2. Phase 1 — session identity
3. Phase 2 — structured retain serializer
4. Phase 3 — durable queue
5. Phase 4 — fresh recall redesign
6. Phase 5 — append transport
7. Phase 6 — config simplification
8. Phase 7 — retain semantics finalization
9. Phase 8 — diagnostics
10. Phase 9 — docs/rationale

Reason:
- identity + serializer + queue are foundation
- recall redesign simpler once durable model is clear
- docs should follow stable behavior, not lead it

## Approved decisions before coding

These are approved for implementation:
- [x] Default recall mode: `tools`
- [x] Default retain backend: session append primary, legacy advanced compatibility mode retained temporarily
- [x] Project config remains fully supported
- [x] Linked hosts becomes experimental/hidden from normal UX
- [x] Keep `#nomem` / `#skip`
- [x] Auto bank creation in official mode disabled by default

## Success criteria

Implementation plan v2 is complete when:
- [ ] recall uses current-turn query
- [ ] stable session document ID exists
- [ ] retain uses structured append records
- [ ] queue survives restart/offline
- [ ] defaults are simple and documented
- [ ] indicators stay UI-only by default
- [ ] old recall cache knobs are gone or deprecated
- [ ] README + docs match actual runtime
- [ ] architecture can be defended cleanly to Hindsight maintainers/community

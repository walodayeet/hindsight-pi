Implement PLAN.md fully for Hindsight-pi v3. Work in order, run tests/typecheck. Mark DONE steps in final response.

Progress iteration 1:
- Added declarative retain preparation module (`extensions/retain/prepare.ts`).
- Added retainContent/strip/toolFilter config fields and env parsing.
- Integrated retain preparation into message_end queue path.
- Excludes hindsight-recall custom messages and Hindsight tool feedback loops from prepared retention.
- Preserves best-effort secret redaction in retention preparation.
- Verified: npm run typecheck && npm test pass.

Progress iteration 2:
- Added session metadata module (`extensions/meta.ts`) with `hindsight-meta` support.
- Added `/hindsight:toggle-retain`, `/hindsight:tag`, and `/hindsight:remove-tag` commands.
- Integrated session retention state and session tags into message_end queueing.
- Status now reports session retention, session tags, queue counts, recall tags, tag match, and observation scopes.
- Added session meta unit tests.
- Verified: npm run typecheck && npm test pass.

Progress iteration 3:
- Added `extensions/session-document.ts` stable session document helpers.
- Queue now uses Pi session id with deterministic fallback document id.
- Queued records use session-derived Hindsight context and session start timestamp.
- Added current-session parse command and parse-and-upsert command.
- Added historical session import placeholder command.
- Added session-document unit tests.
- Verified: npm run typecheck && npm test pass.

Reflection iteration 4:
- Accomplished: recall query safety, canonical recall type/filtering, retainBatch usage, message_end JSONL queue, retain preparation, scoped recall tags, session meta controls, stable document helpers, and parse/upsert current session.
- Working well: small modules with unit tests are keeping typecheck/tests green; status command is becoming a useful diagnostics surface.
- Not working/blocking: some v3 features are still shallow (historical import placeholder, setup profiles not interactive yet, prune command only current session). The plan is broad, so finishing fully will require phased depth after core correctness.
- Approach adjustment: continue landing safe, testable slices rather than attempting one huge rewrite. Prioritize correctness/safety commands and docs before live smoke.
- Next priorities: real prune command, v3 docs, concise AGENTS.md, setup/status docs, then improve setup profiles and live smoke.

Progress iteration 4:
- Implemented confirmable `/hindsight:prune-recall-messages confirm` for the current session file.
- Added `docs/architecture-v3.md`.
- Rewrote `AGENTS.md` to short high-signal procedural guidance.
- Updated README with v3 defaults, recall query behavior, retainBatch/scopes, and persisted recall caveat.
- Verified: npm run typecheck && npm test pass.

Progress iteration 5:
- Extended saveConfig to persist v3 fields (recall query limits, auto recall display/persist, constant tags, recall tags/match, projectName, observationScopes, retainContent, strip, toolFilter).
- Added `/hindsight:profile broad|project|cwd|global|isolated` setup preset command.
- Added doctor diagnostics/warnings for recall tags, tag match, and observation scopes.
- Updated docs/config.md and docs/commands-and-tools.md with v3 config/command references.
- Verified: npm run typecheck && npm test pass.

Progress iteration 6:
- Added queue unit tests covering persistence, malformed-line tolerance, explicit deletion, and preserving files until delete.
- Added retain preparation tests covering Hindsight tool feedback-loop exclusion, tool result exclusion, thinking inclusion config, strip fields, and secret redaction.
- Verified queue survives as JSONL and malformed lines do not break reading.
- Verified: npm run typecheck && npm test pass.

Reflection iteration 7:
- Accomplished: v3 core is mostly in place: query builder, context filtering, retainBatch, queue, session docs, tags/scopes, metadata controls, docs, and tests.
- Working well: new functionality is modular and covered by focused tests; no typecheck regressions.
- Not working/blocking: live smoke has not yet been run; persisted recall mode was config-only until this iteration; historical session import remains placeholder.
- Approach adjustment: finish remaining safety/UX edges, then run live smoke before deeper historical import work.
- Next priorities: persisted recall visibility, tag/scope tests, live smoke, and historical import depth.

Progress iteration 7:
- Added renderer support for persisted/displayed `hindsight-recall` messages.
- Implemented optional `autoRecallPersist`/`autoRecallDisplay` behavior while keeping provider context injection ephemeral/current-turn.
- Added tag/scope unit tests for `{project}`, automatic tags, and observation scope expansion.
- Verified persisted recall remains filtered by context handler and excluded from retention path.
- Verified: npm run typecheck && npm test pass.

Progress iteration 8:
- Updated smoke client to use retainBatch with append, document_id, tags, and observation_scopes.
- Ran live smoke against http://192.168.9.24:8888 successfully (resultCount=4).
- Added unit test verifying autoRecallTags and autoRecallTagsMatch are passed to Hindsight recall.
- Verified project-specific recall plumbing at unit level; live server connectivity works.
- Verified: npm run typecheck && npm test pass.

Progress iteration 9:
- Added fork-aware parent session id extraction helper.
- Recall, automatic tags, and observation scopes now receive parent session context where Pi exposes it.
- Implemented confirmable historical session import for JSONL files in the current session directory.
- Added parent-id unit test.
- Verified: npm run typecheck && npm test pass.

Reflection iteration 10:
- Accomplished: the extension now has most critical v3 behavior in code and tests, including live retainBatch smoke.
- Working well: diagnostics and tests are now broad enough to catch queue/retain/tag regressions.
- Not working/blocking: full end-to-end Pi provider-context testing is still manual; historical import is useful but simple and not fork-deduplicating deeply.
- Approach adjustment: focus next on final verification/cleanup, not more architecture churn.
- Next priorities: expose flush error state, ensure failed flush preserves queues, final docs/status review, run full tests/live smoke again.

Progress iteration 10:
- Added flush state tracking module with last flush timestamp/error.
- Lifecycle and manual queue flush now record success/failure and preserve queue on failure.
- Status reports last flush time and last flush error.
- Added flush-state unit test.
- Verified: npm run typecheck && npm test pass.

Progress iteration 11:
- Ran final-style repository verification: git status review, typecheck, full tests, and live smoke.
- Confirmed no lingering `hindsight-context` provider-memory type references remain.
- Confirmed no direct `.retain(` calls remain in extension code; writes use retainBatch paths.
- Live smoke against http://192.168.9.24:8888 passed again (resultCount=4).
- Verified: npm run typecheck && npm test pass.

Progress iteration 12:
- Fixed v3 config parsing so object-shaped retainContent/strip/toolFilter and observationScopes from config files are preserved instead of falling back.
- Kept env JSON parsing support for v3 object/array config.
- Added tests for resolving v3 object config fields.
- Added tests for saving v3 profile/config fields.
- Verified: npm run typecheck && npm test pass.

Reflection iteration 13:
- Accomplished: v3 implementation is functionally broad and repeatedly verified; tests now cover query, queue, retain preparation, tags, config, session docs, flush, and pruning.
- Working well: extracting command logic into pure helpers makes safety-critical behavior testable.
- Not working/blocking: true provider-context injection still needs manual Pi runtime validation; historical import remains simple.
- Approach adjustment: continue extracting/test-covering high-risk command logic, then stop when verification is clean rather than adding unnecessary scope.
- Next priorities: prune helper tests, privacy docs, final smoke/typecheck, and concise final status.

Progress iteration 13:
- Extracted persisted recall pruning into `extensions/prune.ts`.
- Updated `/hindsight:prune-recall-messages` to use the tested prune helper.
- Added prune unit test verifying preview mode, confirm/write mode, malformed-line preservation, and removing only `hindsight-recall` entries.
- Added architecture-v3 privacy tradeoffs section.
- Verified: npm run typecheck && npm test pass.

Progress iteration 14:
- Added `extensions/recall-message.ts` for canonical recall custom type, filtering, and message creation.
- Refactored context filtering/current-turn recall injection to use the tested recall-message helpers.
- Added recall-message unit tests for stale recall filtering and hidden current-turn message creation.
- Verified canonical `hindsight-recall` type remains centralized while status UI keeps separate status type.
- Verified: npm run typecheck && npm test pass.

Progress iteration 15:
- Strengthened retention preparation to honor per-message `#nomem` and `#skip` opt-outs in the new message_end queue path.
- Added tests proving `#nomem`/`#skip` user messages are excluded from auto-retain.
- Added explicit test for meta-memory inspection prompt exclusion in retain preparation.
- Verified: npm run typecheck && npm test pass.

Reflection iteration 16:
- Accomplished: v3 is now past the core-risk phase. Recall safety, retention durability, tags/scopes, session metadata, pruning, docs, and live smoke are all covered.
- Working well: repeated typecheck/test/live-smoke cycles are green; most risky behaviors now have focused unit tests.
- Not working/blocking: Pi runtime provider-context verification is still the main remaining non-automated check; full historical fork deduplication remains intentionally shallow.
- Approach adjustment: avoid expanding scope further. Do final polish, keep known limitations documented, and prepare a concise handoff.
- Next priorities: final status/remaining-gap audit and optional manual Pi runtime smoke.

Progress iteration 16:
- Improved `/hindsight:toggle-retain` enable message to offer `/hindsight:parse-and-upsert-session` before continuing, covering the backfill-after-disabled workflow.
- Re-ran full validation: npm run typecheck, npm test, and live smoke against http://192.168.9.24:8888.
- Live smoke passed again (resultCount=4).

Progress iteration 17:
- Audited extension/docs for lingering TODO/placeholder text; no remaining implementation placeholders found beyond legitimate placeholder terminology for tag expansion.
- Updated PLAN.md checklist markers to completed for the v3 implementation work performed in this loop.
- Re-ran validation after PLAN.md update: npm run typecheck && npm test pass.

Progress iteration 18:
- Performed final verification run: npm run typecheck, npm test, and live smoke against http://192.168.9.24:8888 all passed.
- Reviewed git diff stat for changed tracked files and confirmed changes are concentrated in v3 recall/retain/config/docs/tests.
- PLAN.md checklist has been marked complete from prior iteration.
- No further implementation work is planned in this loop; remaining caveat is optional manual Pi runtime provider-context observation outside automated tests.

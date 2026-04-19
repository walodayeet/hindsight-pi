# Hindsight-pi Architecture

This document defines runtime architecture for a pi extension that uses Hindsight as durable memory backend.

Scope:
- extension lifecycle
- bank naming and mapping
- context injection strategy
- upload strategy
- graceful degradation
- differences from Honcho design

Non-goals:
- exact production code
- packaging and publishing workflow
- advanced TUI beyond setup/status commands

## 1. Design Goals

Goals:
1. Give pi durable memory across sessions and reloads.
2. Keep every-turn latency low enough for normal coding-agent use.
3. Make memory behavior deterministic and debuggable.
4. Preserve usefulness even when Hindsight is unavailable.
5. Reuse proven pi-memory-honcho structure where it maps cleanly.

## 2. Main Translation: Honcho → Hindsight

Honcho-centered design:
- session key
- user peer
- AI peer
- context/dialectic across peers
- optional linked hosts

Hindsight-centered design:
- bank ID
- retain raw content into bank
- recall raw memories from bank
- reflect synthesized answer from bank
- optional mental models inside bank

Key consequence:
- bank is primary durable unit
- pi extension must decide how one project/session/branch maps onto one bank
- there is no direct peer/session dialectic equivalent to copy from Honcho

## 3. Runtime Components

Planned modules:
- `extensions/config.ts` — load config, env vars, defaults, normalization
- `extensions/client.ts` — initialize `HindsightClient`, resolve bank ID, create/check bank
- `extensions/session.ts` — deterministic bank/session naming helpers
- `extensions/context.ts` — cached recall results and prompt rendering
- `extensions/upload.ts` — turn-to-memory conversion and batching
- `extensions/tools.ts` — LLM-callable tools backed by Hindsight APIs
- `extensions/commands.ts` — setup/status/doctor/sync commands
- `extensions/index.ts` — lifecycle wiring

## 4. Lifecycle

## 4.1 session_start

Responsibilities:
- load config
- if disabled, set extension status to off and stop there
- initialize singleton `HindsightClient`
- resolve deterministic bank ID for current project/session
- confirm bank exists, or create it if config allows
- clear in-memory cache from previous session instance
- optionally preload cheap recall context for first turn

Why here:
- registration phase must stay pure in pi
- network/bootstrap belongs in event handlers

## 4.2 before_agent_start

Responsibilities:
- decide whether to inject memory this turn
- reuse cached context if still fresh
- otherwise run low-cost `recall` query or set of queries
- render concise `[Persistent memory]` block into system prompt
- in hybrid mode, also remind model that explicit Hindsight tools exist for deeper lookups

Decision:
- do not call `reflect` by default on every turn
- default injection path is `recall`

Reason:
- recall returns raw facts cheaply
- reflect is more expensive and slower
- prompt injection needs concise trusted context, not heavy synthesis every turn

## 4.3 agent_end

Responsibilities:
- if saveMessages enabled, transform new conversation messages into retainable memory entries
- upload asynchronously or per configured frequency
- update status to syncing / connected / offline
- increment counters so next turn knows whether refresh threshold was crossed

Upload unit:
- default unit should be per turn, batched into one or more `retainBatch` calls
- each retained item should stay natural-language and include minimal context metadata

## 4.4 session_shutdown / session_before_switch / session_before_fork / session_before_compact

Responsibilities:
- flush pending uploads
- persist any non-Hindsight local state only if needed
- avoid data loss on session transitions

This matches Honcho extension shape and should be retained.

## 5. Bank Naming and Mapping Strategy

## 5.1 Requirements

Bank ID must be:
- deterministic
- stable across reloads
- readable enough for debugging
- unique enough to avoid cross-project collisions
- configurable when users want shared banks

## 5.2 Proposed Strategy Set

Config field: `bankStrategy`

Allowed values:
- `per-directory` — default
- `git-branch`
- `pi-session`
- `per-repo`
- `global`
- `manual`

Behavior:

### per-directory
Default. Hash or slug absolute cwd.

Use when:
- one repo per workspace
- user wants stable project memory

### git-branch
Base on repo slug + current branch.

Use when:
- feature branches should have isolated memory

Tradeoff:
- avoids contamination between unrelated branches
- fragments long-term project memory more aggressively

### pi-session
Base on pi session identity.

Use when:
- experiments need strong isolation

Tradeoff:
- weakest long-term continuity

### per-repo
Use repository root name or repo slug, independent of subdirectory.

Use when:
- monorepo or nested working directories should share one bank

### global
Single bank for all directories under host.

Use when:
- user wants one personal coding memory bank

### manual
User specifies explicit `bankId`.

Use when:
- migrating existing Hindsight bank
- team standard requires exact bank names

## 5.3 Recommended Default

Default should be `per-repo`, not `per-directory`, for this project.

Reason:
- coding-agent memory usually tracks repo-level facts and preferences
- subdirectory changes should not fork memory accidentally
- this maps better to Hindsight bank as durable knowledge container

Implementation note:
- if repo root cannot be resolved, fall back to `per-directory`

## 6. Prompt Injection Strategy

Config field: `recallMode`

Allowed values:
- `hybrid`
- `context`
- `tools`
- `off`

Meaning:

### context
Inject memory only. Do not advertise tools aggressively.

### tools
Do not inject recalled context. Expose tools only.

### hybrid
Inject concise recall-based memory and expose tools for deeper retrieval.

### off
Disable Hindsight behavior except setup/status commands.

## 6.1 Default Query Shape

Use one or two cheap recall queries, not open-ended reflection.

Recommended query families:
- user/project preferences
- recent active work / durable project facts

Example internal queries:
- `What user preferences, coding preferences, and workflow preferences matter here?`
- `What durable project facts, architecture facts, and recent work context matter for this repo?`

Then merge top results into compact sections:
- user / style
- project / architecture
- recent memory

## 6.2 Token Budget

Config field: `contextTokens`

Behavior:
- render no more than rough 4 chars per token budget
- if over budget, trim by section priority

Priority order:
1. user preferences
2. project architecture facts
3. recent work context
4. status/debug metadata

## 6.3 Refresh Policy

Refresh triggers should be cheap and predictable.

Config fields:
- `contextRefreshTtlSeconds`
- `contextCadence`
- `contextRefreshMessageThreshold`
- `injectionFrequency`

Recommended defaults:
- injection every turn in hybrid/context mode
- recall refresh if TTL expired or enough new uploaded messages accumulated
- first turn should force refresh after session bootstrap

## 7. Upload Strategy

## 7.1 What to Upload

Upload:
- user prompts
- assistant final responses
- useful tool-result summaries when they encode durable outcomes

Do not upload blindly:
- giant raw file dumps
- repetitive edit diffs
- transient shell noise with no durable value
- duplicated context already summarized that turn

## 7.2 Upload Shape

Preferred shape:
- one retained item per meaningful message, or
- one retained item per turn summary plus selected raw messages

Recommended metadata keys:
- `source`: `pi`
- `role`: `user | assistant | toolResult | summary`
- `cwd`
- `repoRoot`
- `branch`
- `sessionKey`
- `timestamp`
- `turnIndex` when available

Recommended natural-language content format:

```text
[assistant response]
Repo: hindsight-pi
Branch: master
Session: <session-key>
Summary: We decided to model Hindsight banks per repo and use recall for prompt injection.
```

## 7.3 Write Frequency

Config field: `writeFrequency`

Allowed values:
- `async`
- `turn`
- `session`
- integer N

Meaning:
- `async`: queue and flush in background after turns
- `turn`: flush every turn synchronously
- `session`: only flush on session transitions and shutdown
- integer: flush every N turns

Recommended default: `async`

## 8. Tools Architecture

Core tools:
- `hindsight_search` → raw `recall`
- `hindsight_context` → synthesized `reflect`
- `hindsight_retain` → explicit durable write
- `hindsight_bank_profile` → bank status/profile/debug info

Optional later tools:
- `hindsight_refresh_mental_model`
- `hindsight_list_mental_models`

Rule:
- raw retrieval and synthesis stay separate
- avoid one overloaded tool that hides cost/behavior

## 9. Command Architecture

Core commands:
- `/hindsight:setup`
- `/hindsight:status`
- `/hindsight:config`
- `/hindsight:doctor`
- `/hindsight:mode`
- `/hindsight:sync`
- `/hindsight:map`

Rule:
- commands manage config and health
- tools serve model-facing retrieval/writes

## 10. Graceful Degradation

When Hindsight unavailable:
- never crash pi session
- show status `offline`
- skip prompt injection
- return explicit but short tool errors
- preserve pending uploads in memory for best-effort flush until session end

Doctor command should distinguish:
- config missing
- auth failure
- bank missing
- API unreachable
- upload error
- recall/reflect error

## 11. Mental Models Positioning

Mental models are optional optimization, not MVP requirement.

Use later for:
- stable user profile
- stable project summary
- repo architecture summary

Do not block MVP on them because:
- recall already covers prompt injection needs
- mental model management adds more config and refresh semantics
- extension first needs simple reliable bank lifecycle

## 12. Recommended MVP Behavior

1. Bootstrap client and bank on `session_start`.
2. Recall concise memory context on first turn and refresh by TTL/cadence.
3. Inject compact memory block in `before_agent_start`.
4. Upload turn content after `agent_end` using retain/batching.
5. Expose raw search and synthesis tools.
6. Provide setup/status/doctor commands.
7. Treat mental models as future enhancement.

## 13. Differences From Honcho Design

Keep from Honcho:
- module split: config/client/context/tools/commands/upload/index
- status indicator states: off / connected / syncing / offline
- flush on shutdown/switch/fork/compact
- explicit tools for raw search vs synthesis

Do not copy from Honcho:
- peer modeling
- linked-host fanout
- dialectic reasoning level logic
- peer-card / AI-card prompt sections
- session-based peer conclusion APIs

Replace with Hindsight-native concepts:
- bank profile / background
- retain / recall / reflect
- optional disposition traits
- optional mental models

## 14. Open Questions for TP-003

Implementation task should inspect package behavior for:
- whether `createBank` needs pre-check or is safe on existing bank
- exact SDK error objects and status handling
- best metadata shape for retain items
- whether recall supports explicit result limit in SDK helper
- whether local instances require API key in all supported deployments

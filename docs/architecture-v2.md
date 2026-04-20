# Hindsight-pi Architecture v2

Status: proposed
Owner: walodayeet
Purpose: define future architecture for `hindsight-pi` before next stabilization/official-hub push.

## Goals

Architecture v2 should make `hindsight-pi`:
- Hindsight-native
- easier to defend publicly and to Hindsight maintainers
- more reliable under network/server failure
- less controversial by default
- still stronger on transparency and UX than simpler integrations

## Core principles

1. **Fresh recall, not session cache**
   - Recall should be based on current user turn.
   - Long-lived cached recall blobs are removed as primary architecture.
   - Optional micro-cache allowed only for identical request tuples.

2. **Session document as primary durable unit**
   - One stable document per pi session.
   - Retention appends to that session document over time.
   - Session document becomes canonical durable record.

3. **Structured retention payloads**
   - Retention payloads should be structured JSON append records.
   - Plaintext `[user]` / `[assistant]` summaries become legacy/compat path only if needed.

4. **Durable local queue**
   - Retention writes must survive restart/offline/server failure.
   - Queue should replay automatically on reconnect/startup.

5. **UI-only indicators by default**
   - Recall/retain signals remain visible.
   - Indicators should not pollute transcript/model context by default.

6. **Simple official defaults, advanced optional**
   - Official/default mode should be easy to explain.
   - Advanced knobs should exist, but not dominate first-time UX.

7. **Integration over reimplementation**
   - Extension should integrate with Hindsight, not duplicate broad Hindsight administration features.
   - Diagnostics and inspection are good; full management complexity should stay limited.

## Non-goals

Architecture v2 is not trying to:
- become full Hindsight admin UI
- optimize for most magical/hidden behavior
- keep every old config knob forever
- preserve all experimental multi-server behavior in default path

## Runtime layers

### 1. Config layer
Responsibilities:
- load merged config
- resolve global/project precedence
- validate defaults
- expose official vs advanced profiles
- handle deprecated fields

Current files:
- `extensions/config.ts`

Likely future split:
- `extensions/config/load.ts`
- `extensions/config/save.ts`
- `extensions/config/schema.ts`

### 2. Session identity layer
Responsibilities:
- stable session identity
- stable session document ID
- workspace/repo metadata
- lineage/fork metadata

Current files:
- `extensions/session.ts`

Required outputs:
- `sessionId`
- `sessionDocumentId`
- `workspaceName`
- `repoRoot?`
- `repoRemote?`
- `branch?`
- `parentSessionId?`
- `startedAt`

### 3. Recall layer
Responsibilities:
- derive recall query from current turn
- fetch recall fresh from Hindsight
- render ephemeral memory block
- optionally use tiny identical-request micro-cache
- never depend on session-level cached recall blob

Current files:
- `extensions/context.ts`

Likely future split:
- `extensions/recall/query.ts`
- `extensions/recall/fetch.ts`
- `extensions/recall/render.ts`

### 4. Retain serialization layer
Responsibilities:
- convert turn/session events into structured records
- sanitize/redact
- filter operational junk
- attach metadata/tags

Current files:
- `extensions/upload.ts`

Likely future split:
- `extensions/retain/serialize.ts`
- `extensions/retain/filter.ts`
- `extensions/retain/tags.ts`

### 5. Durable queue layer
Responsibilities:
- persist pending writes locally
- replay on reconnect/startup/flush
- compact acked items
- expose queue status

New files:
- `extensions/queue.ts`

### 6. Hindsight transport layer
Responsibilities:
- official client usage
- append session records
- recall operations
- bank profile/insights
- capability fallback if needed

Current files:
- `extensions/client.ts`

### 7. UX / command layer
Responsibilities:
- setup/settings/doctor/status/where
- compact indicators
- explicit tools
- queue/flush diagnostics

Current files:
- `extensions/index.ts`
- `extensions/commands.ts`
- `extensions/tools.ts`

## Data model

### Session identity

```ts
interface SessionIdentity {
  sessionId: string;
  sessionDocumentId: string;
  workspaceName: string;
  cwd: string;
  repoRoot?: string;
  repoRemote?: string;
  branch?: string;
  parentSessionId?: string;
  startedAt: string;
}
```

Why:
- stable canonical durable unit
- easier defense to maintainers/community
- supports append mode and lineage

### Session append record

```ts
interface SessionAppendRecord {
  schemaVersion: 1;
  recordType: "turn" | "session_event" | "manual_note";
  sessionId: string;
  documentId: string;
  sequence: number;
  timestamp: string;
  workspace: {
    name: string;
    cwd: string;
    repoRoot?: string;
    repoRemote?: string;
    branch?: string;
  };
  tags: string[];
  payload:
    | {
        type: "turn";
        userText?: string;
        assistantText?: string;
        toolCalls?: Array<{
          name: string;
          summary?: string;
        }>;
        metadata: {
          optOut?: boolean;
          retainMode: string;
          source: "pi";
        };
      }
    | {
        type: "session_event";
        event: "start" | "fork" | "switch" | "shutdown";
        detail?: string;
      }
    | {
        type: "manual_note";
        text: string;
      };
}
```

Why:
- structured, machine-readable, reprocessable
- better than plaintext turn summaries as primary format
- easier future migration/import/analysis

### Queue item

```ts
interface QueueItem {
  id: string;
  createdAt: string;
  status: "pending" | "acked" | "failed";
  attempts: number;
  target: {
    baseUrl: string;
    bankId: string;
    documentId: string;
  };
  operation: {
    type: "append-record";
    record: SessionAppendRecord;
  };
  lastError?: string;
}
```

## Recall architecture

## Current problem

Current recall path uses session-level cached context with TTL/cadence/message-threshold behavior. This is hard to defend because recall should primarily depend on current user message.

## Future design

### Default path
On every `before_agent_start`:
1. inspect latest user message
2. derive recall query from current turn
3. fetch recall fresh from Hindsight
4. render memory block if enabled
5. show UI-only compact notice

### Optional micro-cache
Allowed only if all of these match:
- bank ID
- normalized query
- recall types
- per-type count
- display mode

TTL should be very short, e.g. 10-30s.

This cache is performance optimization only, not session memory cache.

### Query derivation
Preferred input:
- latest meaningful user text
- stripped control tags and obvious noise
- optional fallback to latest meaningful prompt if user says only `continue`

### Recall modes
Recommended stable set:
- `hybrid` — inject constrained recall block + keep tools
- `tools` — no automatic injection; tools only
- `off`

`context` mode should be reviewed and possibly removed/deprecated if it no longer adds clear value.

### Injection defaults
Recommended official/default posture:
- `recallMode = "tools"`
- no automatic prompt injection by default
- compact UI-only recall visibility remains allowed
- grouped recall rendering still supported for non-default/hybrid mode
- `recallTypes = ["observation", "experience"]`
- `recallPerType = 2`
- `injectionFrequency = "first-turn"` when hybrid mode is enabled

### Memory block constraints
Injected memory block should:
- be ephemeral
- not appear as transcript message
- be stripped before retention
- remain compact and typed

## Retain architecture

## Current problem

Current retain path uses summarized turn plaintext/chunk writes as primary representation. This is practical but controversial as canonical durable format.

## Future design

### Primary default: session document append
Each pi session gets one stable `document_id`.

At session start:
- establish session identity
- optionally append `session_event:start`

During retained turns:
- append structured JSON turn records to same session document

At shutdown:
- append `session_event:shutdown`

### Advanced retain modes
Official/default modes:
- session document append backend
- `response`
- `off`

Advanced modes:
- `step-batch`
- `both`
- optional legacy plaintext turn-summary compatibility mode during migration

### Sanitization/filtering
Retain pipeline should remove:
- injected memory block
- reasoning tags
- giant base64 blobs
- UI indicator messages
- low-value operational noise

### Tags/metadata
Recommended auto-tags:
- `session:<sessionId>`
- `workspace:<workspaceName>`
- `repo:<repoSlug>`
- `branch:<branch>`
- `source:pi`
- `kind:turn`
- `parent_session:<id>` when relevant

## Durable queue architecture

## Goals
Queue must be:
- crash-safe
- restart-safe
- offline-safe
- replay-safe

## Storage recommendation
Preferred paths:
- `~/.hindsight/queue/<sessionDocumentId>.ndjson`
- or queue metadata in `~/.hindsight/queue/index.json`

Per-session queue files are easier to inspect and compact.

## Replay triggers
Replay should occur on:
- session start
- reconnect
- manual `/hindsight:sync` or `/hindsight:flush`
- shutdown flush

## UI behavior
If writes are queued/offline:
- show compact notice
- do not dump raw low-level errors to chat
- keep detail in doctor/status/logging paths

## Config architecture v2

## Keep
- global + project config
- `/hindsight:where`
- explicit save scope selection

## Simplify
Move to:
- basic settings
- advanced recall settings
- advanced retain settings
- diagnostics

## Remove/deprecate when recall cache removed
Potentially deprecate:
- `contextRefreshTtlSeconds`
- `contextRefreshMessageThreshold`
- `contextCadence`

## Core config shape

```json
{
  "enabled": true,
  "baseUrl": "http://<your-hindsight-host>:8888",
  "bankStrategy": "per-repo",
  "bankId": "optional-manual-bank",
  "host": {
    "pi": {
      "recallMode": "hybrid",
      "recallTypes": ["observation", "experience"],
      "recallPerType": 2,
      "recallDisplayMode": "grouped",
      "injectionFrequency": "first-turn",
      "retainMode": "response",
      "stepRetainThreshold": 5,
      "writeFrequency": "turn",
      "showRecallIndicator": true,
      "showRetainIndicator": true,
      "indicatorsInContext": false
    }
  }
}
```

## UX architecture

## Keep
Transparency is product strength. Keep:
- `/hindsight:where`
- `/hindsight:doctor`
- `/hindsight:status`
- compact lifecycle indicators

## Stable wording
Recall:
- `🧠 Memory loaded (N snippets)`

Retain:
- `💾 Memory retained`
- `⏳ Memory queued for async save`
- `⏳ Memory queued for session end`
- `⏳ Memory queued for N-turn batch`
- `⏭ Memory skipped: below step threshold`

Wording should map one-to-one to actual transport state.

## Experimental / advanced features

These should be hidden or demoted from default UX:
- linked hosts / multi-server recall
- exotic bank strategies in setup
- old recall cache tuning knobs
- overly broad default injection

## Keep as strengths
Even in official-facing shape, keep:
- global + project config support
- config source inspection
- secret sanitization
- opt-out support (`#nomem` / `#skip`)
- bank/profile diagnostics
- compact UI-only indicators

## Approved decisions

These decisions are approved for architecture v2:

1. Default recall mode:
   - `tools`

2. Default retain backend:
   - session document append is primary
   - legacy turn-summary mode may remain temporarily as advanced compatibility path during migration

3. Project config:
   - keep fully supported

4. Linked hosts:
   - keep only as experimental/hidden feature

5. Opt-out hashtags:
   - keep `#nomem` / `#skip`

6. Auto bank creation:
   - disabled by default in official mode

## Success criteria

Architecture v2 is successful when:
- recall fetched fresh from current turn
- session has stable document ID
- retain uses structured append records
- disk queue survives restart/offline
- defaults are simple and documented
- indicators are UI-only by default
- obsolete cache knobs are removed/deprecated
- design can be explained cleanly to Hindsight maintainers/community

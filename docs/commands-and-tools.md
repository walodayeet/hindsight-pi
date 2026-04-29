# Hindsight-pi Commands and Tools

This document defines exact user-facing contract for commands and LLM tools.

## Naming Rule

Use `hindsight_*` for LLM-callable tools.
Use `/hindsight:*` for slash commands.

Reason:
- clear namespace
- avoids collision with Honcho and generic memory packages
- readable for model and operator

## LLM Tools

## 1. `hindsight_search`

Purpose:
- raw retrieval from Hindsight using `recall`

When model should use it:
- user asks for past facts, prior decisions, preferences, project history, or architecture details
- low-cost context lookup is enough
- raw evidence is preferable to synthesis

Implemented parameters:

```ts
{
  query: string;
  budget?: 'low' | 'mid' | 'high';
}
```

Behavior:
- uses configured `recallTypes` from `config.json`
- searches active bank
- also searches `globalBankId` when configured
- also fans out to linked hosts when configured

Output:
- numbered raw memory snippets
- optional memory type labels
- no heavy synthesis

## 2. `hindsight_context`

Purpose:
- synthesized answer from Hindsight using `reflect`

When model should use it:
- user asks for summary, synthesis, or "what should I know"
- question needs integration across many memories
- raw recall output would be noisy

Proposed parameters:

```ts
{
  query: string;
  context?: string;
  budget?: 'low' | 'mid' | 'high';
}
```

Output:
- `reflect` text answer
- optionally short source summary if available from response

## 3. `hindsight_retain`

Purpose:
- explicit durable write for high-value facts, preferences, and decisions

When model should use it:
- user explicitly says to remember something
- a durable preference or decision is established
- storing this in memory is more appropriate than waiting for async upload

Proposed parameters:

```ts
{
  content: string;
  context?: string;
}
```

Output:
- short confirmation text

## 4. `hindsight_bank_profile`

Purpose:
- inspect current bank identity/debug info

When model should use it:
- user asks what bank is active
- user asks whether memory is connected
- debugging configuration

Proposed parameters:

```ts
{}
```

Output:
- bank ID
- bank name/background when available
- base URL / environment summary
- mode summary

## Optional Later Tools

Not required for MVP:
- `hindsight_list_mental_models`
- `hindsight_refresh_mental_model`
- `hindsight_recall_trace`

## Slash Commands

## 1. `/hindsight:setup`

Purpose:
- first-time setup flow

Responsibilities:
- collect enabled flag
- collect base URL
- collect API key if needed
- choose bank strategy
- optionally set manual bank ID
- optionally set global bank ID
- collect recall types
- collect write frequency and save-messages behavior
- collect reasoning level/cap and preview length
- save config
- reconnect and validate

## 2. `/hindsight:status`

Purpose:
- show current connection and runtime status

Should display:
- enabled/disabled
- connected/offline
- active bank ID
- global bank ID
- base URL
- recall mode
- recall types
- reasoning level/cap
- write frequency
- cache freshness info if available

## 3. `/hindsight:config`

Purpose:
- show effective config with secrets redacted

Use:
- debugging normalization and env overrides

## 4. `/hindsight:doctor`

Purpose:
- preflight health check

Checks should include:
- config readable
- base URL valid
- API reachable
- auth valid
- bank resolved
- bank exists or can be created
- simple recall works with configured `recallTypes`

## 5. `/hindsight:mode`

Purpose:
- switch between `hybrid`, `context`, `tools`, `off`

Use:
- let user control injection/tool behavior without editing config file manually

## 6. `/hindsight:sync`

Purpose:
- force immediate context refresh

Use:
- after major decisions
- after setup changes
- when user says memory feels stale

## 7. `/hindsight:map`

Purpose:
- map current path/repo to explicit bank ID

Use:
- override derived strategy for one project

## Prompt Guidance Contract

Extension should add prompt guidance similar to:
- use `hindsight_search` for raw facts and evidence
- use `hindsight_context` for synthesized memory answers
- use `hindsight_retain` for explicit durable memories

In hybrid mode injected prompt should also mention:
- persistent memory block may be stale between refreshes
- explicit Hindsight tools exist for deeper or fresher lookup

## Differences From Honcho Tooling

Replace Honcho tools:
- `honcho_search` → `hindsight_search`
- `honcho_context` → `hindsight_context`
- `honcho_conclude` → `hindsight_retain`
- `honcho_profile` / `honcho_seed_identity` do not map directly

Why no direct `profile` analog in MVP:
- Hindsight is bank-first, not peer-card-first
- profile-like summaries should come from recall, reflect, or later mental models

## Recommended MVP Surface

Implemented:
- tools: `hindsight_search`, `hindsight_context`, `hindsight_retain`, `hindsight_bank_profile`
- commands: `/hindsight:setup`, `/hindsight:status`, `/hindsight:config`, `/hindsight:doctor`, `/hindsight:mode`, `/hindsight:sync`, `/hindsight:map`, `/hindsight:recall`, `/hindsight:retain`, `/hindsight:settings`

## v3 Commands

- `/hindsight:popup` — show exact last recall payload from extension-owned state.
- `/hindsight:flush` — flush current session queue with retainBatch append payloads.
- `/hindsight:profile broad|project|cwd|global|isolated` — apply a v3 memory routing preset.
- `/hindsight:toggle-retain` — toggle automatic retention for the current session.
- `/hindsight:tag <tag>` — add a session tag included on flush.
- `/hindsight:remove-tag <tag>` — remove a session tag.
- `/hindsight:parse-session` — parse current session to JSON for inspection.
- `/hindsight:parse-and-upsert-session` — upsert current session as one stable Hindsight document.
- `/hindsight:prune-recall-messages confirm` — remove persisted `hindsight-recall` entries from the current session file.

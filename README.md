# Hindsight-pi

Transparent, Hindsight-native persistent memory for pi.

`Hindsight-pi` gives pi durable memory backed by Hindsight banks, with visible recall/retain signals, predictable config precedence, and controls for both simple and advanced workflows.

## Why this extension

Most memory extensions optimize for magic. `Hindsight-pi` optimizes for clarity.

What makes it different:
- Hindsight-native bank model, not fake peer abstractions
- visible memory lifecycle: you can see when memory loads and when memory is retained
- global + project config hierarchy with source inspection
- controllable recall and retain behavior
- prompt-cache-friendlier defaults
- explicit Hindsight tools for search, synthesis, retention, and bank inspection

Best fit:
- long-lived repo work
- self-hosted Hindsight users
- power users who want memory they can inspect and control
- technical sessions where memory quality matters more than magic

## Features

- durable memory via Hindsight banks
- deterministic bank mapping per repo, directory, session, or manual bank ID
- recall injected into agent prompt using Hindsight recall
- explicit synthesis via Hindsight reflect-backed tool
- visible, compact memory indicators
- compact, non-revealing retain notifications
- non-blocking async/session/batched retain modes
- global config plus project-local override support
- config source inspection with `/hindsight:where`
- explicit tools:
  - `hindsight_search`
  - `hindsight_context`
  - `hindsight_retain`
  - `hindsight_bank_profile`

## Install

Install from npm:

```bash
pi install npm:@walodayeet/hindsight-pi
```

Install from GitHub:

```bash
pi install git:github.com/walodayeet/pi-hindsight
```

Local dev load:

```bash
cd G:/tmp/test/Hindsight-pi
npm install
pi -e ./extensions/index.ts
```

## Quick start

### 1. Start Hindsight server

Example tested server:

```text
http://<your-hindsight-host>:8888
```

### 2. Load extension in pi

If installed from npm or git, restart pi or reload extensions.

### 3. Run setup

```text
/hindsight:setup
```

Setup is intentionally basic:
- enable Hindsight
- set base URL
- optional API key
- choose bank style
- choose recall mode
- choose retain mode
- choose save scope: global or project

Everything else gets sane defaults.

### 4. Verify

```text
/hindsight:doctor
/hindsight:status
/hindsight:where
```

## Default behavior

Publish defaults aim for predictable, low-noise memory:

- bank strategy: `manual` if explicit `bankId` exists, else `per-repo`
- recall mode: `hybrid`
- recall types: `observation,experience`
- recall per type: `2`
- recall display: `grouped`
- injection frequency: `first-turn`
- retain mode: `response`
- step retain threshold: `5`
- write frequency: `turn`
- show recall indicator: `true`
- show retain indicator: `true`
- indicators in context: `false`

## Commands

Main commands:
- `/hindsight:setup` — first-time setup
- `/hindsight:settings` — edit settings; basic first, advanced optional
- `/hindsight:status` — runtime and bank status
- `/hindsight:doctor` — connectivity and bank preflight
- `/hindsight:where` — show config sources and precedence
- `/hindsight:sync` — refresh recall cache now
- `/hindsight:map` — map current directory to explicit bank ID

Supporting commands:
- `/hindsight:config` — show effective resolved config
- `/hindsight:connect` — reconnect now
- `/hindsight:stats` — fetch bank stats if exposed by server
- `/hindsight:mode` — quick recall mode switch

## Tools

Available to agent/tooling:
- `hindsight_search` — raw memory search
- `hindsight_context` — synthesized memory context
- `hindsight_retain` — explicit durable write
- `hindsight_bank_profile` — bank profile/insights

## Config model

`Hindsight-pi` supports both global and project-local config.

Checked sources:
- `~/.hindsight/config.toml`
- `~/.hindsight/config.json`
- parent `.../.hindsight/config.toml`
- parent `.../.hindsight/config.json`

Save targets used by extension UI:
- global: `~/.hindsight/config.json`
- project: `<repo>/.hindsight/config.json`

Precedence:
- project config overrides global for current repo
- `/hindsight:where` shows exactly which files exist and what values they contribute

### Example global config

```json
{
  "baseUrl": "http://<your-hindsight-host>:8888",
  "bankId": "optional-manual-bank",
  "bankStrategy": "manual",
  "host": {
    "pi": {
      "enabled": true,
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

### Compatibility aliases

These aliases are also accepted:
- `api_url` -> `baseUrl`
- `api_key` -> `apiKey`
- `bank_id` -> `bankId`
- `global_bank` -> `globalBankId`
- `recall_types` -> `recallTypes`

## Recall behavior

Recall uses Hindsight recall results to inject memory into prompt context.

Key knobs:
- `recallMode`
  - `hybrid` — inject recall and keep tools available; recommended default
  - `context` — rely on injected context only
  - `tools` — no automatic prompt injection; use tools only
  - `off` — disable recall
- `recallTypes`
  - `observation`
  - `experience`
  - `world`
- `recallPerType`
  - fetch this many snippets per selected type
- `recallDisplayMode`
  - `grouped` — inject grouped by type
  - `unified` — inject one flattened list
- `injectionFrequency`
  - `first-turn` — prompt-cache-friendlier default
  - `every-turn`

User-facing recall notice stays compact:

```text
🧠 Memory loaded (3 snippets)
```

Full recalled content can still be injected internally when enabled.

## Retain behavior

Retain writes summarized conversation memory back into Hindsight.

### Retain modes

- `response`
  - retain current turn summary
- `step-batch`
  - retain accumulated process buffer only when threshold reached
- `both`
  - if step batch fires, process retain saves accumulated buffer and response retain keeps assistant-only response to avoid duplicate full-turn retention
  - otherwise retains normal full turn
- `off`
  - disable retain

### Write frequencies

- `turn`
  - save immediately after response
- `async`
  - queue save asynchronously; non-blocking
- `session`
  - queue until session flush/end
- numeric value like `5`
  - queue and flush after that many turns

### Retain indicators

Compact retain notices use stable wording:
- `Memory retained`
- `Memory queued for async save`
- `Memory queued for session end`
- `Memory queued for N-turn batch`

When `indicatorsInContext = false`, indicators stay visible to user without polluting agent context.

## Common recipes

### 1. Simple memory

Use when you want strong defaults with minimal tuning.

```json
{
  "baseUrl": "http://<your-hindsight-host>:8888",
  "host": {
    "pi": {
      "enabled": true,
      "recallMode": "hybrid",
      "retainMode": "response"
    }
  }
}
```

### 2. Technical repo memory

Use when doing longer engineering sessions and you want lower noise.

```json
{
  "host": {
    "pi": {
      "recallMode": "hybrid",
      "recallTypes": ["observation", "experience"],
      "recallPerType": 2,
      "recallDisplayMode": "grouped",
      "injectionFrequency": "first-turn",
      "retainMode": "response",
      "writeFrequency": "turn"
    }
  }
}
```

### 3. Minimal prompt-cache churn

Use when prompt stability matters most.

```json
{
  "host": {
    "pi": {
      "recallMode": "tools",
      "injectionFrequency": "first-turn",
      "showRecallIndicator": true,
      "indicatorsInContext": false
    }
  }
}
```

## Troubleshooting

### Wrong base URL

Run:

```text
/hindsight:where
```

If project config exists, it overrides global for current repo.

### Wrong bank selected

Check:
- `/hindsight:status`
- `/hindsight:where`

If `bankId` exists, strategy defaults to `manual` unless explicitly changed.

### Project config overriding global

Expected behavior.

Use:

```text
/hindsight:where
```

Then either:
- edit `<repo>/.hindsight/config.json`
- delete project config
- or save future changes to global instead

### Retain looks queued instead of saved

Check `writeFrequency`:
- `async` => queued for async delivery
- `session` => queued until session end/flush
- numeric => queued until threshold reached
- `turn` => saved immediately

### Connection fails with localhost

Likely wrong config source won precedence.

Run:

```text
/hindsight:where
```

Look for project config writing an unexpected host such as `http://localhost:8888`.

## Session naming

Extension uses workspace-style session names derived from current directory rather than renaming session to bank ID.

## Development

Commands:

```bash
npm run typecheck
npm test
npm run smoke
```

Smoke test against real server:

```bash
HINDSIGHT_BASE_URL=http://<your-hindsight-host>:8888 npm run smoke
```

## Release positioning

`Hindsight-pi` aims to be:
- most transparent Hindsight extension for pi
- Hindsight-native, inspectable, controllable
- good for serious long-lived repo work

Not aiming to be:
- most magical
- most hidden
- most minimal

## Publish checklist

Before release:
- run `npm run typecheck`
- run `npm test`
- run smoke test against live Hindsight server
- verify setup from empty config
- verify global-only config
- verify project-only config
- verify project overrides global as expected
- verify `/hindsight:where` output
- verify recall compact notice
- verify retain saved and queued notices
- bump version
- tag release

## Verified locally

Passed during development:

```bash
npm run typecheck
npm test
HINDSIGHT_BASE_URL=http://<your-hindsight-host>:8888 npm run smoke
```

## Project layout

- `extensions/index.ts` — lifecycle wiring and indicators
- `extensions/config.ts` — config loading, precedence, normalization, saving
- `extensions/client.ts` — Hindsight bootstrap and bank creation
- `extensions/session.ts` — bank/session naming logic
- `extensions/context.ts` — recall cache and prompt rendering
- `extensions/upload.ts` — retention batching, sanitization, write scheduling
- `extensions/tools.ts` — explicit Hindsight tools
- `extensions/commands.ts` — setup, settings, status, doctor, where
- `docs/` — architecture and config notes
- `tests/` — unit tests and smoke script

## License

MIT

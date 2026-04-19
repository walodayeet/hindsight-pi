# Hindsight-pi

Hindsight-backed persistent memory extension for pi.

Status:
- architecture complete
- MVP extension scaffold implemented
- local tests passing
- smoke-tested against Hindsight at `http://192.168.9.24:8888`

## What It Does

This extension gives pi durable memory through Hindsight memory banks.

Core behavior:
- bootstraps `HindsightClient` on session start
- maps current repo/session to deterministic Hindsight bank ID
- injects concise recall-based memory into prompt context
- uploads conversation turns back into Hindsight after agent completion
- exposes explicit tools for raw search, synthesis, durable writes, and bank inspection

## Implemented Surface

### Slash commands
- `/hindsight:setup`
- `/hindsight:status`
- `/hindsight:config`
- `/hindsight:doctor`
- `/hindsight:mode`
- `/hindsight:sync`
- `/hindsight:map`
- `/hindsight:recall`
- `/hindsight:retain`
- `/hindsight:settings`

### LLM tools
- `hindsight_search`
- `hindsight_context`
- `hindsight_retain`
- `hindsight_bank_profile`

## Project Layout

- `extensions/index.ts` — lifecycle wiring
- `extensions/config.ts` — config loading and normalization
- `extensions/client.ts` — Hindsight bootstrap and bank ensure
- `extensions/session.ts` — bank ID derivation
- `extensions/context.ts` — cached recall-driven prompt context
- `extensions/upload.ts` — turn upload batching and sanitization
- `extensions/tools.ts` — LLM-callable Hindsight tools
- `extensions/commands.ts` — operator commands
- `docs/` — architecture and contract docs
- `tests/` — unit tests and smoke client script

## Install

From this repo:

```bash
cd G:/tmp/test/Hindsight-pi
npm install
```

Load in pi for testing:

```bash
pi -e ./extensions/index.ts
```

Install as pi package from npm:

```bash
pi install npm:@walodayeet/hindsight-pi
```

Install as pi package from git:

```bash
pi install git:github.com/walodayeet/pi-hindsight
```

## Quick Setup for Current Hindsight Server

Create `~/.hindsight/config.json`:

```json
{
  "apiKey": "your-key",
  "baseUrl": "http://192.168.9.24:8888",
  "bankStrategy": "per-repo",
  "bankId": "optional-manual-bank",
  "globalBankId": "optional-global-bank",
  "recallTypes": ["observation"],
  "host": {
    "pi": {
      "enabled": true,
      "workspace": "pi",
      "recallMode": "hybrid",
      "recallTypes": ["observation"],
      "autoCreateBank": true,
      "contextTokens": 1200,
      "contextRefreshTtlSeconds": 300,
      "contextRefreshMessageThreshold": 8,
      "contextCadence": 1,
      "injectionFrequency": "every-turn",
      "writeFrequency": "async",
      "saveMessages": true,
      "searchBudget": "mid",
      "reflectBudget": "low",
      "dialecticDynamic": true,
      "reasoningLevel": "low",
      "reasoningLevelCap": "medium",
      "toolPreviewLength": 500,
      "maxMessageLength": 25000,
      "showRecallIndicator": true,
      "showRetainIndicator": true,
      "indicatorsInContext": false,
      "logging": true
    }
  },
  "mappings": {
    "/abs/path/to/project": "manual-bank-id"
  }
}
```

Compat aliases from `pi-hindsight` also accepted in same file:
- `api_url` -> `baseUrl`
- `api_key` -> `apiKey`
- `bank_id` -> `bankId`
- `global_bank` -> `globalBankId`
- `recall_types` -> `recallTypes`

Project-local override also supported:
- `.hindsight/config.json`
- local values override global values

Alternative interactive setup once loaded in pi:

```text
/hindsight:setup
```

Recommended first checks:

```text
/hindsight:doctor
/hindsight:status
```

## Development Commands

```bash
npm run typecheck
npm test
npm run smoke
```

## Verified Test Results

Passed locally:

```bash
npm run typecheck
npm test
HINDSIGHT_BASE_URL=http://192.168.9.24:8888 npm run smoke
```

Smoke test result:
- connected successfully
- ensured bank `hindsight-pi-smoke`
- retained test memory
- recalled that memory successfully

## Design Notes

Key design decisions:
- Hindsight bank is primary durable unit
- default bank strategy is `per-repo`
- prompt injection uses `recall` by default
- explicit synthesis uses `reflect`
- mental models are optional later optimization, not MVP dependency

See:
- `docs/hindsight-api-notes.md`
- `docs/architecture.md`
- `docs/config.md`
- `docs/commands-and-tools.md`

## Publish

Publish to npm:

```bash
npm login
npm publish --access public
```

Push repo to GitHub:

```bash
git remote add origin https://github.com/walodayeet/pi-hindsight.git
git add .
git commit -m "Initial release: hindsight-pi"
git push -u origin master
```

Package gallery notes:
- package includes `pi-package` keyword for discovery
- `pi.dev/packages` indexes npm packages and git-installable pi packages
- after publish, install with `pi install npm:@walodayeet/hindsight-pi`

## Release Readiness

Ready for publish:
- typecheck passes
- tests pass
- npm tarball verified with `npm pack --dry-run`
- config contract covers global + local `config.json`
- `pi-hindsight` compat aliases supported
- taskplane artifacts ignored from publish/repo flow

Future enhancements, not release blockers:
- richer doctor/status diagnostics
- stronger SDK typing instead of local shims
- more selective upload summarization for noisy tool-heavy sessions
- optional mental-model support

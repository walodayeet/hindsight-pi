# Hindsight-pi Config

This document defines proposed config contract for Hindsight-pi.

Status legend:
- Verified — backed by external docs or existing Honcho/pi patterns
- Proposed — chosen contract for this repo; implementation task should follow it

## Config File Location

Primary config file:
- `~/.hindsight/config.json`

Reason:
- mirrors Honcho extension pattern of user-level config
- keeps secrets out of repo
- simple for global pi extension use

Project-local override may be added later, but not required for MVP.

## Proposed File Shape

```json
{
  "apiKey": "hsd-...",
  "baseUrl": "https://api.hindsight.vectorize.io",
  "bankId": "optional-manual-bank",
  "bankStrategy": "per-repo",
  "host": {
    "pi": {
      "enabled": true,
      "workspace": "pi",
      "recallMode": "hybrid",
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
      "toolPreviewLength": 500,
      "maxMessageLength": 25000,
      "logging": true
    }
  },
  "mappings": {
    "/abs/path/to/project": "manual-bank-id"
  }
}
```

## Top-Level Fields

| Field | Status | Meaning |
|---|---|---|
| `apiKey` | Verified | Hindsight API key for cloud or auth-enabled deployments |
| `baseUrl` | Verified | Hindsight API URL; cloud or local |
| `bankId` | Proposed | Manual bank override when `bankStrategy=manual` |
| `bankStrategy` | Proposed | How current pi session maps to bank |
| `host.pi` | Proposed | pi-specific behavior knobs |
| `mappings` | Proposed | explicit path→bank mapping overrides |

## Proposed `bankStrategy` Values

- `per-directory`
- `git-branch`
- `pi-session`
- `per-repo`
- `global`
- `manual`

Recommended default:
- `per-repo`

## Proposed `recallMode` Values

- `hybrid`
- `context`
- `tools`
- `off`

Recommended default:
- `hybrid`

## Proposed Host Fields

| Field | Default | Purpose |
|---|---:|---|
| `enabled` | `true` | master switch for Hindsight integration |
| `workspace` | `pi` | logical host label for status/debug only |
| `recallMode` | `hybrid` | choose injected context vs tools |
| `autoCreateBank` | `true` | create missing bank on startup |
| `contextTokens` | `1200` | injected memory budget |
| `contextRefreshTtlSeconds` | `300` | refresh TTL for cached recall context |
| `contextRefreshMessageThreshold` | `8` | refresh after enough new messages uploaded |
| `contextCadence` | `1` | minimum turns between active refreshes |
| `injectionFrequency` | `every-turn` | inject every turn or first turn only |
| `writeFrequency` | `async` | flush mode for retain uploads |
| `saveMessages` | `true` | upload turn content to Hindsight |
| `searchBudget` | `mid` | default recall budget |
| `reflectBudget` | `low` | default reflect budget |
| `toolPreviewLength` | `500` | raw result truncation for tool output |
| `maxMessageLength` | `25000` | chunk cap before splitting retained content |
| `logging` | `true` | enable extension logging |

## Environment Variables

Proposed env var contract:

| Env var | Maps to |
|---|---|
| `HINDSIGHT_API_KEY` | `apiKey` |
| `HINDSIGHT_BASE_URL` | `baseUrl` |
| `HINDSIGHT_BANK_ID` | `bankId` |
| `HINDSIGHT_BANK_STRATEGY` | `bankStrategy` |
| `HINDSIGHT_RECALL_MODE` | `host.pi.recallMode` |
| `HINDSIGHT_CONTEXT_TOKENS` | `host.pi.contextTokens` |
| `HINDSIGHT_CONTEXT_REFRESH_TTL_SECONDS` | `host.pi.contextRefreshTtlSeconds` |
| `HINDSIGHT_CONTEXT_REFRESH_MESSAGE_THRESHOLD` | `host.pi.contextRefreshMessageThreshold` |
| `HINDSIGHT_CONTEXT_CADENCE` | `host.pi.contextCadence` |
| `HINDSIGHT_INJECTION_FREQUENCY` | `host.pi.injectionFrequency` |
| `HINDSIGHT_WRITE_FREQUENCY` | `host.pi.writeFrequency` |
| `HINDSIGHT_SAVE_MESSAGES` | `host.pi.saveMessages` |
| `HINDSIGHT_SEARCH_BUDGET` | `host.pi.searchBudget` |
| `HINDSIGHT_REFLECT_BUDGET` | `host.pi.reflectBudget` |
| `HINDSIGHT_TOOL_PREVIEW_LENGTH` | `host.pi.toolPreviewLength` |
| `HINDSIGHT_MAX_MESSAGE_LENGTH` | `host.pi.maxMessageLength` |
| `HINDSIGHT_LOGGING` | `host.pi.logging` |

## Defaults Summary

Recommended MVP defaults:

```json
{
  "enabled": true,
  "bankStrategy": "per-repo",
  "recallMode": "hybrid",
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
  "toolPreviewLength": 500,
  "maxMessageLength": 25000,
  "logging": true
}
```

## Validation Rules

Implementation should enforce:
- `baseUrl` required unless extension explicitly supports an implicit default
- `apiKey` required for cloud; local deployments may omit only if doctor confirms endpoint works unauthenticated
- `contextTokens`, TTL, preview length, max message length must be positive integers
- `searchBudget` and `reflectBudget` limited to `low | mid | high`
- `writeFrequency` allowed values: `async | turn | session | positive integer`
- `injectionFrequency` allowed values: `every-turn | first-turn`
- `bankStrategy` and `recallMode` must be normalized to supported values

## Mapping Resolution Order

When deciding bank ID:
1. explicit env `HINDSIGHT_BANK_ID`
2. explicit config `bankId` when strategy is `manual`
3. `mappings[currentPath]`
4. derived value from `bankStrategy`
5. safe fallback to per-directory-derived bank ID

## What MVP Will Not Support Yet

Not in required MVP config:
- multi-host linked memory fanout
- per-tool budgets beyond search/reflect defaults
- mental model declarative config
- project-local repo config file
- migration from Honcho config automatically

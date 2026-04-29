# Hindsight-pi

Transparent long-term memory for [pi](https://github.com/mariozechner/pi) powered by [Hindsight](https://github.com/vectorize-io/hindsight).

`Hindsight-pi` gives pi durable, inspectable memory without hiding what is happening. It recalls relevant memories for the current turn, queues new memories safely, and lets you inspect or prune recall state when needed.

## Highlights

- Fresh recall per user turn; no stale cached memory context.
- Hidden `hindsight-recall` context is filtered so old recalls do not leak back to the model.
- Durable `message_end` retention queue using Hindsight `retainBatch`.
- Session-document append with stable document ids.
- Tags and observation scopes for project/user/session separation.
- One-bank + tags/scopes recommended; multiple banks supported for hard privacy boundaries.
- Friendly setup, status, doctor, config-source inspection, and explicit tools.

## Install

From npm:

```bash
pi install npm:@walodayeet/hindsight-pi
```

From GitHub:

```bash
pi install git:github.com/walodayeet/pi-hindsight
```

Local dev:

```bash
npm install
pi -e ./extensions/index.ts
```

## Quick start

1. Start or connect to a Hindsight server.
2. Load/reload pi.
3. Run:

```text
/hindsight:setup
/hindsight:doctor
/hindsight:status
```

Useful server example:

```text
http://<your-hindsight-host>:8888
```

## Recommended memory setup

For most users:

- Use one Hindsight bank.
- Separate project/global memories with tags and observation scopes.
- Use separate banks only when memories must never mix, e.g. work vs personal or different clients.

Profile presets:

```text
/hindsight:profile broad     # broad recall from configured bank
/hindsight:profile project   # project-scoped recall via {project}
/hindsight:profile cwd       # exact-directory scoped recall
/hindsight:profile global    # global-bank style workflow
/hindsight:profile isolated  # per-repo bank plus project tags
```

## Common commands

```text
/hindsight:setup                  first-time setup
/hindsight:status                 runtime, queue, recall, and bank status
/hindsight:doctor                 connectivity and config diagnostics
/hindsight:where                  show config files and precedence
/hindsight:popup                  show exact last recalled memories
/hindsight:flush                  flush queued retention records
/hindsight:toggle-retain          enable/disable retention for this session
/hindsight:tag <tag>              add session tag
/hindsight:remove-tag <tag>       remove session tag
/hindsight:parse-session          inspect current session as JSON
/hindsight:parse-and-upsert-session
/hindsight:prune-recall-messages confirm
```

## Agent tools

- `hindsight_search` — raw memory search
- `hindsight_context` — synthesized memory context
- `hindsight_retain` — explicit durable memory write
- `hindsight_bank_profile` — inspect active bank

## Config files

Global:

```text
~/.hindsight/config.json
~/.hindsight/config.toml
```

Project-local override:

```text
<repo>/.hindsight/config.json
<repo>/.hindsight/config.toml
```

Use `/hindsight:where` to see which files are active.

Minimal config:

```json
{
  "baseUrl": "http://<your-hindsight-host>:8888",
  "bankId": "my-memory-bank",
  "bankStrategy": "manual",
  "host": {
    "pi": {
      "enabled": true,
      "recallMode": "hybrid",
      "autoRecallTags": ["{project}"],
      "autoRecallTagsMatch": "any_strict",
      "observationScopes": [["{project}"]]
    }
  }
}
```

## Defaults that matter

- Recall query uses raw user input, not expanded skill/slash-command bodies.
- Slash commands with no user request skip recall; slash commands with args recall from the args.
- Oversized recall queries warn and skip by default.
- Auto recall is ephemeral by default (`autoRecallPersist=false`).
- Recall indicators are UI-only by default.
- Retention excludes Hindsight tool feedback and meta-memory inspection prompts.
- `#nomem` and `#skip` opt a turn out of auto-retain.

## Persisted recall caveat

Persisted recall display is for debugging. If you enable it and later uninstall the extension, old recall messages may remain in session files. Before uninstalling, run:

```text
/hindsight:prune-recall-messages confirm
```

Or keep the extension installed but disabled so it can continue filtering old `hindsight-recall` messages.

## More docs

- Architecture: [`docs/architecture-v3.md`](docs/architecture-v3.md)
- Config details: [`docs/config.md`](docs/config.md)
- Commands/tools: [`docs/commands-and-tools.md`](docs/commands-and-tools.md)
- Hindsight project: [github.com/vectorize-io/hindsight](https://github.com/vectorize-io/hindsight)

## Development

```bash
npm run typecheck
npm test
HINDSIGHT_BASE_URL=http://<your-hindsight-host>:8888 npm run smoke
```

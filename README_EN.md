# SkillTruck (`skilltruck`)

[中文](./README.md) | [English](./README_EN.md)

A cross-platform (Windows / Linux / macOS) **Agent Skills manager**. It unifies **install / update / uninstall** for official skills, third-party skill repos, and your own repos, with `project/global` scope and multi-agent target directories.

> Ship skills to every agent.

This project is built on top of `openskills` for installation and optional `AGENTS.md` syncing.

## 30-Second Quick Start

```bash
# 1) Default install (project scope), interactive skill + agent selection
skilltruck install

# 2) Install globally to agent paths under ~
skilltruck install --global

# 3) Use Web UI (left: agents, right: source tabs)
skilltruck webui
```

## Why It's Useful (vs manual copy)

- Install/update once across multiple agent directories
- `project` by default, switch to `global` when needed
- `install <repoOrRef>` auto-writes to `sources.json` (works with `config push/pull`)
- Profiles remember both selected skills and selected agents per scope
- Web UI supports source tabs, search, and visible-item batch actions
- `openskills sync` is explicit via `--sync` (no implicit AGENTS.md changes)

## Command Cheat Sheet

| Command | What it does | Common example |
| --- | --- | --- |
| `skilltruck install [repoOrRef]` | Interactive install with skills + agents; supports single-source install and auto source registration | `skilltruck install --global` |
| `skilltruck update` | Re-install style update using profile + scope + selected agents | `skilltruck update --profile laptop` |
| `skilltruck uninstall [skillNames...]` | Remove selected skills (agent selection first) | `skilltruck uninstall xlsx` |
| `skilltruck webui` | Web UI install mode (search, source tabs, visible-item batch actions) | `skilltruck webui --project` |
| `skilltruck webui --mode uninstall` | Web UI uninstall mode | `skilltruck webui --mode uninstall --global` |
| `skilltruck source ...` | Source management: `list/add/remove/enable/disable` | `skilltruck source add owner/repo` |
| `skilltruck config ...` | Config/profile management: `show/set-default-profile/set-remote-profile-url/push/pull` | `skilltruck config push --profile laptop` |
| `skilltruck paths` | Print config/cache/repo-cache/manifest paths | `skilltruck paths` |

## Environment Variables

| Variable | Purpose |
| --- | --- |
| `SKILLTRUCK_PROFILE` | Temporarily override default profile |
| `SKILLTRUCK_PROFILE_URL` | Temporarily override remote profile base URL for `config push/pull` |
| `SKILLTRUCK_CONCURRENCY` | Default scan concurrency (can be overridden by `--concurrency`) |
| `SKILLTRUCK_AUTO_REFRESH` | Auto-refresh source repo cache switch (`0` disables) |

When upgrading from `@wang121ye/skillmanager`, SkillTruck recognizes the former `SKILLMANAGER_*` variables and existing `skillmanager` config directory; new `SKILLTRUCK_*` variables take precedence. Its bundled source, profile selections, and tombstones are migrated additively without replacing unrelated sources or custom fields.

## Requirements & Compatibility

`skilltruck` uses system `git` to fetch/update source repos and uses `openskills` for installation + sync. If versions are too old, behavior may fail on some machines.

- **Node.js** (for openskills): recommended **>= 20.6.0**
- **openskills**: recommended **>= 1.5.0**
- **git**: recommended **>= 2.34.0**

Common mitigation:

- Upgrade git / Node / openskills
- Reduce concurrency for unstable networks:

```bash
skilltruck webui --concurrency 1
```

### Automatic Cache Refresh

When scanning source repos, `skilltruck` checks whether local cache is behind remote:

- By default, stale cache is automatically refreshed.
- You can force refresh via `--force-refresh`, or disable auto refresh via `SKILLTRUCK_AUTO_REFRESH=0`.

```bash
skilltruck webui --force-refresh
skilltruck install --force-refresh
skilltruck update --force-refresh
```

## Install & Run

### Global install (recommended)

```bash
npm i -g skilltruck
skilltruck install
```

During a global install or upgrade, the npm `postinstall` hook performs an additive configuration migration:

- Adds and enables this repository in the user's `sources.json`.
- Appends `skilltruck:skills/skilltruck` to every existing profile's `selectedSkillIds`.
- Preserves all other sources, selected skills, agent selections, and unknown custom fields instead of replacing whole files with defaults.
- If lifecycle scripts are disabled or configuration is temporarily unwritable, the first CLI run retries safely. Malformed JSON is reported and left untouched.

### Bundled skilltruck skill

This repository includes [`skills/skilltruck/SKILL.md`](./skills/skilltruck/SKILL.md). It guides agents through safe skill installation, updates, removal, source and profile management, and `AGENTS.md` synchronization while preserving the user's unrelated sources and selections.

After a global npm install or upgrade, this skill is automatically registered as a source and selected in existing profiles. The npm install itself does not copy the skill into every agent directory. Run the following command and confirm the interactive selections to install it into the selected global agent directories:

```bash
skilltruck install --global
```

### Direct via npx (no install)

```bash
npx skilltruck install
```

`skilltruck` is an unscoped npm package, and its package and CLI names are identical.

## Core Capabilities

### 1) Interactive install

```bash
skilltruck install
```

Default flow has two selection steps:

- Step 1: select skills (grouped by source)
- Step 2: select target agents (Supported Agents)

Keyboard shortcuts in terminal selection:

- Space: toggle
- `a`: select all, `i`: invert
- `h`: top, `e`: bottom
- `[` / `]`: switch groups
- `Esc`: exit, `Enter`: confirm

### 2) Web UI for install/uninstall

```bash
skilltruck webui
skilltruck webui --project
skilltruck webui --global
```

Web UI features:

- Left panel: `Supported Agents` with independent scrolling
- Right panel: source tabs (`All Sources` + each source)
- `Select all / none / invert` applies to currently visible skills
- Same agent + skill selection UX in install and uninstall modes

You can also use profiles (skill selection + per-scope agent selection are remembered):

```bash
skilltruck webui --profile laptop
skilltruck install --profile laptop
```

### 3) Install from one source directly (and auto-register source)

```bash
skilltruck install https://github.com/wangyendt/wayne-skills
# or
skilltruck install wangyendt/wayne-skills
```

When `repoOrRef` is passed, source is auto upserted into user `sources.json` (existing one is reused). If the source already exists but is disabled, it will be auto-enabled.

## Set a Default Profile (recommended)

```bash
skilltruck config set-default-profile laptop
skilltruck webui
skilltruck install
```

Or temporarily override by env:

```bash
SKILLTRUCK_PROFILE=laptop skilltruck webui
```

## Config Sync Across Machines

You can sync config to cloud storage (OSS/S3/etc.) and pull on a new machine.

Synced content:

- `sources.json`
- `profiles/[profile].json` (selected skills + per-scope selected agents)

Security warning: public write access is dangerous. Prefer signed URLs or private buckets.

### 1) Set remote base URL once

```bash
skilltruck config set-remote-profile-url https://<bucket>.<region>.aliyuncs.com/skilltruck/
```

Or via env:

```bash
export SKILLTRUCK_PROFILE_URL=https://<bucket>.<region>.aliyuncs.com/skilltruck/
```

### 2) Push config

```bash
skilltruck config push
skilltruck config push --profile laptop
```

### 3) Pull config

```bash
skilltruck config pull
skilltruck config pull --profile laptop
```

Then install:

```bash
skilltruck config pull --profile laptop
skilltruck install --profile laptop
```

### 4) Scope behavior

- Default (or `--project`): install into project-level agent directories
- `--global`: install into global agent directories under `~`
- `--project` and `--global` are mutually exclusive
- If multiple selected agents map to the same directory, install is deduplicated

### 5) `AGENTS.md` sync

No sync by default. Use `--sync` explicitly:

```bash
skilltruck install --sync
skilltruck install --sync --output AGENTS.md
```

`install` / `update` / `uninstall` / `webui` all follow the same explicit sync behavior.

### 6) Dry run

```bash
skilltruck install --dry-run
```

Dry run prints:

- skills to install (first 30)
- resolved target directories (deduplicated by path)

## Manage Sources

```bash
skilltruck source add https://github.com/obra/superpowers
skilltruck source add ComposioHQ/awesome-claude-skills
skilltruck source list
```

```bash
skilltruck source disable superpowers
skilltruck source enable superpowers
skilltruck source remove superpowers
```

Supports `owner/repo`, GitHub URL, and `git@github.com:owner/repo.git`.

Built-in sources can also be removed. skilltruck records their IDs in `removedSourceIds`, so later loads and upgrades do not restore them automatically. Adding the same built-in repository again restores its original ID and clears its removal record. A source that used a custom ID must be restored with the same `--id`. `source disable` only deactivates a source and keeps it visible in the list.

## Update Skills

Default behavior updates via profile selection (or all visible skills when no valid profile selection exists):

```bash
skilltruck update
skilltruck update --project
skilltruck update --global
```

Specific profile:

```bash
skilltruck update --profile laptop
```

Adjust selection first with Web UI:

```bash
skilltruck webui --profile laptop
skilltruck update --profile laptop
```

Use openskills-native update path:

```bash
skilltruck update --openskills
```

`--openskills` ignores profile skill/agent selection.

## Uninstall Skills

Recommended (Web UI):

```bash
skilltruck webui --mode uninstall
```

By name (still asks for agents):

```bash
skilltruck uninstall algorithmic-art xlsx
```

By scope:

```bash
skilltruck uninstall --project
skilltruck uninstall --global
skilltruck uninstall --profile laptop
```

Remove all in target directories (dangerous):

```bash
skilltruck uninstall --all
```

`--all` only affects selected agents in the current scope.

## Web UI Screenshot

- `docs/images/webui-overview.png`

![Skillmanager Web UI](docs/images/webui-overview.png)

## Sources Configuration

On first run, built-in `manifests/sources.json` is copied to user config path. You can inspect paths via:

```bash
skilltruck paths
```

## Agent Path Mapping Source (Attribution)

Built-in `manifests/agents.json` is compiled based on:

- Repository: `vercel-labs/skills`
- Section: `Supported Agents`
- License: MIT
- Retrieved at: 2026-11-06

Maintenance rule:

- Treat the upstream `Supported Agents` table as the single source of truth for future agent mapping updates
- See `docs/agent-mapping-maintenance.md` for the update workflow

References:

- https://github.com/vercel-labs/skills
- https://github.com/vercel-labs/skills/blob/main/docs/agents.md#supported-agents
- https://github.com/vercel-labs/skills/blob/main/LICENSE

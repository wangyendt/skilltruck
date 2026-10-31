# Agent Mapping Maintenance

`manifests/agents.json` is maintained against the Supported Agents table in `vercel-labs/skills/docs/agents.md` (moved out of the README).

Source of truth:

- Repo: `https://github.com/vercel-labs/skills`
- Section: `Supported Agents`
- Direct link: `https://github.com/vercel-labs/skills/blob/main/docs/agents.md#supported-agents`

Update rule:

1. Use the agents document table above as the only source of truth for agent `name`, `id`, `projectPath`, and `globalPath`.
2. Expand grouped rows into separate entries in `manifests/agents.json`.
3. Ignore trailing slash differences such as `.agents/skills` vs `.agents/skills/`; treat them as equivalent.
4. After updating mappings, also update `source.retrievedAt` in `manifests/agents.json`.
5. If an upstream agent path changes, prefer matching upstream exactly rather than preserving historical local behavior.

The sync parser uses the upstream `supported-agents:start/end` markers to isolate the generated table, and retains support for legacy README headings. Malformed markers, invalid headers, and unexpectedly large removals fail closed rather than overwriting the manifest.

Current example:

- `Cline` should map to project `.agents/skills` and global `~/.agents/skills` per the upstream table.

Automation:

- Local check: `npm run agents:check`
- Local sync: `npm run agents:sync`
- CI workflow: `.github/workflows/supported-agents-sync.yml`
- Main release workflow: `.github/workflows/release-on-main.yml`
- npm publish workflow: `.github/workflows/publish-npm.yml`
- Scheduled sync runs daily at `03:00` Asia/Shanghai time (`19:00 UTC` in GitHub cron syntax).
- Sync mode is controlled by repository variable `SUPPORTED_AGENTS_SYNC_MODE`:
  - `pr`: detect upstream changes, open a PR, optional patch bump
  - `direct`: commit and push directly to the current branch, optional patch bump; npm publish is then triggered by the separate publish workflow on `main`
  - `notify`: only detect and notify, do not push code
- Default CI behavior is conservative: if `SUPPORTED_AGENTS_SYNC_MODE` is unset, it falls back to `pr`.
- Feishu notification is optional via `scripts/send_lark_notification.py` and these GitHub secrets:
  - `LARK_APP_ID`
  - `LARK_APP_SECRET`
  - `LARK_CHAT_ID` or `LARK_USER_OPEN_ID`
- Auto npm publish is also optional. Set repository variable `AUTO_BUMP_NPM_VERSION=true` to patch-bump during sync, and set `AUTO_PUBLISH_NPM=true` to enable publishing when `package.json` or `package-lock.json` changes on `main`.
- If `AUTO_PUBLISH_NPM=true`, also provide GitHub secret `GH_PAT`. The PAT is used for version-bump pushes so GitHub can trigger the downstream `publish-npm.yml` workflow.
- Core `main` pushes are also covered: changes under `src/**`, `manifests/**`, `skills/**`, or to `package.json`/`package-lock.json` trigger `release-on-main.yml`. If such a push does not already change the package version, the workflow patch-bumps `package.json` and `package-lock.json`, pushes that commit back to `main` using `GH_PAT`, and lets `publish-npm.yml` publish the new version. README, docs, tests, maintenance scripts, screenshots, and workflow-only changes do not publish npm by themselves; use the workflow's manual dispatch when one of those changes must be released immediately.
- npm publishing now uses npm trusted publishing (OIDC) from GitHub Actions. Configure the package-level trusted publisher on npm for:
  - GitHub owner: `wangyendt`
  - Repository: `skilltruck`
  - Workflow file: `publish-npm.yml`
- Only `publish-npm.yml` should be configured as the trusted publisher. Other workflows must not call `npm publish` directly.
- `NPM_TOKEN` is no longer required for publishing after trusted publishing is configured.

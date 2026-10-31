const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  parseSupportedAgentsTable,
  validateAgents
} = require('../scripts/sync-supported-agents');

const table = [
  '| Agent | `--agent` | Project Path | Global Path |',
  '|-------|-----------|--------------|-------------|',
  '| Amp, Replit | `amp`, `replit` | `.agents/skills/` | `~/.config/agents/skills/` |',
  '| Eve | `eve` | `agent/skills/` | N/A (project-only) |'
].join('\n');

const migratedDoc = [
  '# Supported agents',
  '<!-- supported-agents:start -->',
  table,
  '<!-- supported-agents:end -->',
  '## Compatibility',
  '| Feature | Agent |',
  '|---------|-------|',
  '| Basic skills | Yes |'
].join('\n');

test('reads the migrated docs/agents.md table without parsing the compatibility table', () => {
  assert.deepEqual(parseSupportedAgentsTable(migratedDoc), [
    { id: 'amp', name: 'Amp', projectPath: '.agents/skills', globalPath: '~/.config/agents/skills' },
    { id: 'replit', name: 'Replit', projectPath: '.agents/skills', globalPath: '~/.config/agents/skills' },
    { id: 'eve', name: 'Eve', projectPath: 'agent/skills', globalPath: null }
  ]);
});

test('retains support for legacy README headings and headers', () => {
  const legacy = table.replace('| Agent | `--agent` | Project Path | Global Path |',
    '| Name | Agent ID | Project | Global |');
  assert.equal(parseSupportedAgentsTable(`## Supported Agents\n${legacy}\n## Other\n| unrelated |`).length, 3);
});

test('supports unmarked standalone documents with a case-insensitive heading', () => {
  assert.equal(parseSupportedAgentsTable(`# Supported agents\n${table}\n## Compatibility\n| unrelated |`).length, 3);
});

test('rejects incomplete or reversed generated table markers', () => {
  for (const doc of [
    migratedDoc.replace('<!-- supported-agents:end -->', ''),
    migratedDoc.replace('<!-- supported-agents:start -->', ''),
    `<!-- supported-agents:end -->\n# Supported agents\n<!-- supported-agents:start -->\n${table}`
  ]) {
    assert.throws(() => parseSupportedAgentsTable(doc), /标记/);
  }
});

test('does not silently treat a README link-only section as an empty agent list', () => {
  assert.throws(() => parseSupportedAgentsTable(
    '## Supported Agents\nSee [supported agents](docs/agents.md).\n## Creating Skills'
  ), /表格格式异常/);
});

test('keeps header and minimum-count validation', () => {
  assert.throws(() => parseSupportedAgentsTable(migratedDoc.replace('Project Path', 'Unknown Path')), /表头/);
  assert.throws(() => validateAgents(parseSupportedAgentsTable(migratedDoc), []), /最小阈值/);
});

test('default fetch targets the canonical agents document rather than the link-only README', () => {
  const script = fs.readFileSync(path.join(__dirname, '../scripts/sync-supported-agents.js'), 'utf8');
  assert.match(script, /const DEFAULT_SOURCE_URL = 'https:\/\/raw\.githubusercontent\.com\/vercel-labs\/skills\/main\/docs\/agents\.md';/);
});

test('CLI checks a migrated document offline and writes a valid change summary without modifying the manifest', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skilltruck-sync-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const sourceFile = path.join(dir, 'agents.md');
  const manifestFile = path.join(dir, 'agents.json');
  const summaryFile = path.join(dir, 'summary.json');
  const rows = Array.from({ length: 30 }, (_, i) =>
    `| Agent ${i} | \`agent-${i}\` | \`.agents/skills/\` | \`~/.agents/skills/\` |`
  );
  const doc = ['# Supported agents', '<!-- supported-agents:start -->',
    '| Agent | `--agent` | Project Path | Global Path |', '|---|---|---|---|',
    ...rows, '<!-- supported-agents:end -->', '## Compatibility', '| unrelated |'].join('\n');
  const original = JSON.stringify({ version: 1, agents: [] });
  fs.writeFileSync(sourceFile, doc);
  fs.writeFileSync(manifestFile, original);
  const result = spawnSync(process.execPath, [path.join(__dirname, '../scripts/sync-supported-agents.js'),
    '--check', '--source-file', sourceFile, '--manifest', manifestFile, '--summary-json', summaryFile], { encoding: 'utf8' });
  assert.equal(result.status, 1); // Changes found, not a parsing failure.
  assert.equal(result.stderr, '');
  const summary = JSON.parse(fs.readFileSync(summaryFile, 'utf8'));
  assert.equal(summary.changed, true);
  assert.equal(summary.counts.next, 30);
  assert.equal(summary.counts.added, 30);
  assert.equal(fs.readFileSync(manifestFile, 'utf8'), original);
});

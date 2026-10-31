#!/usr/bin/env node

const fs = require('fs/promises');
const path = require('path');
const { httpFetch } = require('../src/lib/http');
const { readJson, writeJson } = require('../src/lib/fs');

const DEFAULT_SOURCE_URL = 'https://raw.githubusercontent.com/vercel-labs/skills/main/docs/agents.md';
const DEFAULT_MANIFEST_PATH = path.resolve(__dirname, '../manifests/agents.json');
const DEFAULT_SUMMARY_PATH = null;
const SOURCE_REPO = 'https://github.com/vercel-labs/skills';
const SOURCE_SECTION = 'Supported Agents';
const SOURCE_LICENSE = 'MIT';
const EXPECTED_TABLE_HEADERS = [
  ['Name', 'Agent'],
  ['Agent ID', '--agent'],
  ['Project', 'Project Path'],
  ['Global', 'Global Path']
];
const MIN_EXPECTED_AGENT_COUNT = 30;
const MAX_REMOVAL_RATIO = 0.2;
const MAX_ABSOLUTE_REMOVALS = 5;

function parseArgs(argv) {
  const args = {
    check: false,
    write: false,
    sourceUrl: DEFAULT_SOURCE_URL,
    sourceFile: null,
    manifestPath: DEFAULT_MANIFEST_PATH,
    summaryJson: DEFAULT_SUMMARY_PATH
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--check') {
      args.check = true;
    } else if (arg === '--write') {
      args.write = true;
    } else if (arg === '--source-url') {
      args.sourceUrl = argv[i + 1];
      i += 1;
    } else if (arg === '--source-file') {
      args.sourceFile = path.resolve(argv[i + 1]);
      i += 1;
    } else if (arg === '--manifest') {
      args.manifestPath = path.resolve(argv[i + 1]);
      i += 1;
    } else if (arg === '--summary-json') {
      args.summaryJson = path.resolve(argv[i + 1]);
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }

  if (!args.check && !args.write) {
    args.check = true;
  }

  if (args.check && args.write) {
    throw new Error('`--check` 与 `--write` 不能同时使用。');
  }

  if (args.sourceFile && args.sourceUrl !== DEFAULT_SOURCE_URL) {
    throw new Error('`--source-file` 与 `--source-url` 不能同时使用。');
  }

  return args;
}

function printHelp() {
  // eslint-disable-next-line no-console
  console.log(`
Usage:
  node scripts/sync-supported-agents.js --check [--summary-json path]
  node scripts/sync-supported-agents.js --write [--summary-json path]

Options:
  --check                 仅检查是否和 upstream 一致；有变化时退出码为 1
  --write                 写回 manifests/agents.json，并同步 README 日期
  --source-url <url>      指定 upstream agents 文档 raw URL
  --source-file <path>    使用本地 Markdown 文件作为输入（便于离线测试）
  --manifest <path>       指定 agents manifest 路径
  --summary-json <path>   输出变更摘要 JSON
  -h, --help              显示帮助
  `.trim());
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function stripBackticks(value) {
  return String(value || '')
    .trim()
    .replace(/^`+/, '')
    .replace(/`+$/, '');
}

function normalizePathValue(value) {
  const cleaned = stripBackticks(value).replace(/\/+$/g, '');
  return cleaned === '~' ? '~' : cleaned;
}

// 上游表格可能用 "N/A (project-only)"、"N/A"、"-" 等标记表示某个 scope 不适用。
function isNotApplicablePath(value) {
  const cleaned = stripBackticks(value).trim();
  return cleaned === '' || cleaned === '-' || cleaned === '—' || /^N\/?A\b/i.test(cleaned);
}

// 返回规范化路径；若该单元格表示「不适用」，返回 null。
function parsePathCell(value) {
  if (isNotApplicablePath(value)) return null;
  return normalizePathValue(value);
}

function splitCsvCell(value) {
  return String(value || '')
    .split(',')
    .map((v) => stripBackticks(v))
    .filter(Boolean);
}

function parseMarkdownTableRow(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed.startsWith('|')) return null;
  const content = trimmed.replace(/^\|/, '').replace(/\|$/, '');
  return content.split('|').map((cell) => cell.trim());
}

function extractSupportedAgentsSection(markdown) {
  // Upstream moved the generated table from README.md to docs/agents.md.
  // Prefer its explicit boundaries so unrelated compatibility tables are ignored.
  const startMarker = '<!-- supported-agents:start -->';
  const endMarker = '<!-- supported-agents:end -->';
  const start = markdown.indexOf(startMarker);
  const end = markdown.indexOf(endMarker);
  if (start !== -1 || end !== -1) {
    if (start === -1 || end === -1 || end <= start ||
        markdown.indexOf(startMarker, start + startMarker.length) !== -1 ||
        markdown.indexOf(endMarker, end + endMarker.length) !== -1) {
      throw new Error('`Supported Agents` 表格边界标记异常。');
    }
    return markdown.slice(start + startMarker.length, end);
  }

  // Keep --source-file/--source-url compatible with the legacy README format.
  const startMatch = /^#{1,2} Supported Agents[ \t]*\r?$/im.exec(markdown);
  if (!startMatch) {
    throw new Error('未找到 `Supported Agents` 章节。');
  }

  const rest = markdown.slice(startMatch.index + startMatch[0].length);
  const nextHeadingMatch = /\n#{1,2}\s+/m.exec(rest);
  return nextHeadingMatch ? rest.slice(0, nextHeadingMatch.index) : rest;
}

function parseSupportedAgentsTable(markdown) {
  const section = extractSupportedAgentsSection(markdown);
  const lines = section
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().startsWith('|'));

  if (lines.length < 3) {
    throw new Error('`Supported Agents` 表格格式异常。');
  }

  const headerCols = parseMarkdownTableRow(lines[0]);
  if (!headerCols || headerCols.length < EXPECTED_TABLE_HEADERS.length) {
    throw new Error('`Supported Agents` 表头格式异常。');
  }
  for (let i = 0; i < EXPECTED_TABLE_HEADERS.length; i += 1) {
    const actualHeader = stripBackticks(headerCols[i]);
    const expectedHeaders = EXPECTED_TABLE_HEADERS[i];
    if (!expectedHeaders.includes(actualHeader)) {
      throw new Error(
        `\`Supported Agents\` 表头第 ${i + 1} 列异常，预期为 ${expectedHeaders.map((item) => `\`${item}\``).join(' 或 ')}，实际为 \`${actualHeader}\``
      );
    }
  }

  const dataLines = lines.slice(2).filter((line) => !/^\|\s*-+\s*\|/.test(line));
  const agents = [];

  for (const line of dataLines) {
    const cols = parseMarkdownTableRow(line);
    if (!cols || cols.length < 4) continue;

    const names = splitCsvCell(cols[0]);
    const ids = splitCsvCell(cols[1]);
    const projectPath = parsePathCell(cols[2]);
    const globalPath = parsePathCell(cols[3]);

    if (!names.length || !ids.length) {
      throw new Error(`表格行无法解析名称或 agent id: ${line}`);
    }
    if (names.length !== ids.length) {
      throw new Error(`名称数与 agent id 数不一致: ${line}`);
    }
    if (!projectPath && !globalPath) {
      throw new Error(`Project/Global 路径不能同时为空: ${line}`);
    }

    for (let i = 0; i < ids.length; i += 1) {
      agents.push({
        id: ids[i],
        name: names[i],
        projectPath,
        globalPath
      });
    }
  }

  return agents;
}

function validatePathShape(fieldName, value, { allowTilde = false } = {}) {
  if (!value) {
    throw new Error(`${fieldName} 不能为空。`);
  }

  if (allowTilde && value === '~') {
    return;
  }

  const looksLikeRelativePath =
    value.startsWith('./') ||
    value.startsWith('../') ||
    value.startsWith('.') ||
    value.startsWith('/') ||
    /^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9._-]+)*$/.test(value);
  const looksLikeHomePath = allowTilde && value.startsWith('~/');

  if (!looksLikeRelativePath && !looksLikeHomePath) {
    throw new Error(`${fieldName} 路径格式异常：${value}`);
  }

  if (/\s/.test(value)) {
    throw new Error(`${fieldName} 路径不应包含空白字符：${value}`);
  }
  if (value.includes('://')) {
    throw new Error(`${fieldName} 不应为 URL：${value}`);
  }
}

function validateAgents(nextAgents, currentAgents) {
  if (!Array.isArray(nextAgents) || nextAgents.length < MIN_EXPECTED_AGENT_COUNT) {
    throw new Error(
      `解析得到的 agent 数量异常：${Array.isArray(nextAgents) ? nextAgents.length : 'N/A'}，低于最小阈值 ${MIN_EXPECTED_AGENT_COUNT}`
    );
  }

  const seenIds = new Set();
  for (const agent of nextAgents) {
    const normalized = normalizeAgentForCompare(agent);
    if (!normalized.id) {
      throw new Error('存在空的 agent id。');
    }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(normalized.id)) {
      throw new Error(`agent id 格式异常：${normalized.id}`);
    }
    if (seenIds.has(normalized.id)) {
      throw new Error(`检测到重复的 agent id：${normalized.id}`);
    }
    seenIds.add(normalized.id);

    if (!normalized.name) {
      throw new Error(`agent name 不能为空：${normalized.id}`);
    }

    if (!normalized.projectPath && !normalized.globalPath) {
      throw new Error(`agent 至少需要一个有效路径：${normalized.id}`);
    }
    if (normalized.projectPath) {
      validatePathShape(`projectPath(${normalized.id})`, normalized.projectPath);
    }
    if (normalized.globalPath) {
      validatePathShape(`globalPath(${normalized.id})`, normalized.globalPath, { allowTilde: true });
    }
  }

  if (Array.isArray(currentAgents) && currentAgents.length > 0) {
    const minSafeCount = Math.max(
      MIN_EXPECTED_AGENT_COUNT,
      Math.ceil(currentAgents.length * (1 - MAX_REMOVAL_RATIO))
    );
    if (nextAgents.length < minSafeCount) {
      throw new Error(
        `解析结果数量骤减：当前 ${currentAgents.length}，新结果 ${nextAgents.length}，低于安全阈值 ${minSafeCount}`
      );
    }
  }
}

function normalizeAgentForCompare(agent) {
  return {
    id: String(agent?.id || '').trim(),
    name: String(agent?.name || '').trim(),
    projectPath: normalizePathValue(agent?.projectPath || ''),
    globalPath: normalizePathValue(agent?.globalPath || '')
  };
}

function equalAgent(a, b) {
  const aa = normalizeAgentForCompare(a);
  const bb = normalizeAgentForCompare(b);
  return aa.id === bb.id &&
    aa.name === bb.name &&
    aa.projectPath === bb.projectPath &&
    aa.globalPath === bb.globalPath;
}

function diffAgents(currentAgents, nextAgents) {
  const currentMap = new Map(currentAgents.map((agent) => [agent.id, normalizeAgentForCompare(agent)]));
  const nextMap = new Map(nextAgents.map((agent) => [agent.id, normalizeAgentForCompare(agent)]));

  const added = [];
  const removed = [];
  const updated = [];

  for (const [id, nextAgent] of nextMap.entries()) {
    const currentAgent = currentMap.get(id);
    if (!currentAgent) {
      added.push(nextAgent);
      continue;
    }
    if (!equalAgent(currentAgent, nextAgent)) {
      const fieldChanges = {};
      for (const key of ['name', 'projectPath', 'globalPath']) {
        if (currentAgent[key] !== nextAgent[key]) {
          fieldChanges[key] = {
            before: currentAgent[key],
            after: nextAgent[key]
          };
        }
      }
      updated.push({
        id,
        before: currentAgent,
        after: nextAgent,
        changes: fieldChanges
      });
    }
  }

  for (const [id, currentAgent] of currentMap.entries()) {
    if (!nextMap.has(id)) removed.push(currentAgent);
  }

  const orderChanged =
    currentAgents.length === nextAgents.length &&
    currentAgents.some((agent, index) => agent?.id !== nextAgents[index]?.id);

  return {
    changed: added.length > 0 || removed.length > 0 || updated.length > 0 || orderChanged,
    added,
    removed,
    updated,
    orderChanged
  };
}

async function fetchSourceMarkdown({ sourceFile, sourceUrl }) {
  if (sourceFile) {
    return fs.readFile(sourceFile, 'utf8');
  }

  const response = await httpFetch(sourceUrl, {
    headers: {
      'user-agent': 'skilltruck-agent-sync/1.0'
    }
  });
  if (!response.ok) {
    throw new Error(`获取 upstream agents 文档失败：${response.status} ${response.statusText}`);
  }
  return response.text();
}

async function updateReadmeRetrievedAt(filePath, nextDate) {
  const raw = await fs.readFile(filePath, 'utf8');
  const next = raw
    .replace(/(- 访问日期：)\d{4}-\d{2}-\d{2}/, `$1${nextDate}`)
    .replace(/(- Retrieved at: )\d{4}-\d{2}-\d{2}/, `$1${nextDate}`);
  if (next !== raw) {
    await fs.writeFile(filePath, next, 'utf8');
  }
}

function formatSummary(summary) {
  const lines = [];
  lines.push(`changed=${summary.changed}`);
  lines.push(`current=${summary.counts.current}`);
  lines.push(`next=${summary.counts.next}`);
  lines.push(`added=${summary.counts.added}`);
  lines.push(`removed=${summary.counts.removed}`);
  lines.push(`updated=${summary.counts.updated}`);

  if (summary.added.length) {
    lines.push(`added_ids=${summary.added.map((item) => item.id).join(',')}`);
  }
  if (summary.removed.length) {
    lines.push(`removed_ids=${summary.removed.map((item) => item.id).join(',')}`);
  }
  if (summary.updated.length) {
    lines.push(`updated_ids=${summary.updated.map((item) => item.id).join(',')}`);
  }

  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const currentManifest = await readJson(args.manifestPath);
  const currentAgents = Array.isArray(currentManifest?.agents) ? currentManifest.agents : [];
  const markdown = await fetchSourceMarkdown(args);
  const nextAgents = parseSupportedAgentsTable(markdown);
  validateAgents(nextAgents, currentAgents);
  const retrievedAt = todayIsoDate();
  const diff = diffAgents(currentAgents, nextAgents);

  if (diff.removed.length > Math.max(MAX_ABSOLUTE_REMOVALS, Math.ceil(currentAgents.length * MAX_REMOVAL_RATIO))) {
    throw new Error(
      `检测到异常删除：当前 ${currentAgents.length} 个 agent，本次删除 ${diff.removed.length} 个，已超过安全阈值`
    );
  }

  const summary = {
    changed: diff.changed,
    sourceUrl: args.sourceFile ? args.sourceFile : args.sourceUrl,
    retrievedAt,
    counts: {
      current: currentAgents.length,
      next: nextAgents.length,
      added: diff.added.length,
      removed: diff.removed.length,
      updated: diff.updated.length
    },
    added: diff.added,
    removed: diff.removed,
    updated: diff.updated,
    orderChanged: diff.orderChanged
  };

  if (args.summaryJson) {
    await fs.mkdir(path.dirname(args.summaryJson), { recursive: true });
    await fs.writeFile(args.summaryJson, JSON.stringify(summary, null, 2) + '\n', 'utf8');
  }

  if (args.write && diff.changed) {
    const nextManifest = {
      version: Number(currentManifest?.version || 1),
      source: {
        repo: SOURCE_REPO,
        section: SOURCE_SECTION,
        license: SOURCE_LICENSE,
        retrievedAt
      },
      agents: nextAgents
    };
    await writeJson(args.manifestPath, nextManifest);
    await updateReadmeRetrievedAt(path.resolve(__dirname, '../README.md'), retrievedAt);
    await updateReadmeRetrievedAt(path.resolve(__dirname, '../README_EN.md'), retrievedAt);
  }

  // eslint-disable-next-line no-console
  console.log(formatSummary(summary));

  if (args.check && diff.changed) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err?.stack || String(err));
    process.exit(1);
  });
}

module.exports = {
  parseSupportedAgentsTable,
  diffAgents,
  normalizePathValue,
  extractSupportedAgentsSection,
  validateAgents
};

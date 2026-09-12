import { TASK_STATUSES } from './schema.mjs';

const taskStatuses = new Set(TASK_STATUSES);

function requireCondition(condition, message) {
  if (!condition) throw new Error(`Invalid management Markdown: ${message}`);
}

function stripInlineFormatting(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith('`') && trimmed.endsWith('`') && trimmed.length >= 2) return trimmed.slice(1, -1);
  return trimmed;
}

function sectionText(text, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^## ${escaped}\\s*$`, 'm').exec(text);
  if (!match) return undefined;
  const start = match.index + match[0].length;
  const remainder = text.slice(start);
  const nextHeading = remainder.search(/^## /m);
  return remainder.slice(0, nextHeading === -1 ? undefined : nextHeading).trim();
}

function parseBulletFields(text) {
  const fields = new Map();
  for (const match of text.matchAll(/^- ([^:\n]+):\s*(.+)$/gm))
    fields.set(match[1].trim(), stripInlineFormatting(match[2]));
  return fields;
}

function requireField(fields, name, section) {
  const value = fields.get(name);
  requireCondition(value, `${section} requires ${name}`);
  return value;
}

export function parseWorkerLog(text) {
  requireCondition(typeof text === 'string', 'worker log must be text');
  const currentText = sectionText(text, 'Current status');
  requireCondition(currentText, 'Current status section is required');
  const fields = parseBulletFields(currentText);
  const status = requireField(fields, 'Status', 'Current status');
  requireCondition(taskStatuses.has(status), `Current status has unknown Status ${status}`);
  const current = {
    currentTask: requireField(fields, 'Current task', 'Current status'),
    status,
    branch: requireField(fields, 'Branch', 'Current status'),
    lastKnownCommit: requireField(fields, 'Last known commit', 'Current status'),
    blocker: requireField(fields, 'Blocker', 'Current status'),
    lastActivity: requireField(fields, 'Last activity', 'Current status'),
  };

  const activityText = sectionText(text, 'Activity log') ?? '';
  const activities = [];
  const headings = [...activityText.matchAll(/^### (\S+)\s+—\s+(.+)$/gm)];
  for (const [index, heading] of headings.entries()) {
    const start = heading.index + heading[0].length;
    const end = headings[index + 1]?.index ?? activityText.length;
    const activityFields = parseBulletFields(activityText.slice(start, end));
    activities.push({
      timestamp: heading[1],
      title: heading[2].trim(),
      ...Object.fromEntries(
        [...activityFields.entries()].map(([key, value]) => [
          key.slice(0, 1).toLowerCase() + key.slice(1).replaceAll(' ', ''),
          value,
        ]),
      ),
    });
  }
  return { current, activities };
}

export function parseTaskRecord(text) {
  requireCondition(typeof text === 'string', 'task record must be text');
  const topFields = new Map();
  for (const match of text.matchAll(/^(Task ID|Title|Worker|Start|Finish|Status|Disposition):\s*(.+)$/gm))
    topFields.set(match[1], stripInlineFormatting(match[2]));
  for (const field of ['Task ID', 'Title', 'Worker', 'Start', 'Finish', 'Status'])
    requireCondition(topFields.get(field), `task record requires ${field}`);
  requireCondition(
    taskStatuses.has(topFields.get('Status')),
    `task record has unknown Status ${topFields.get('Status')}`,
  );

  const sections = {};
  const headings = [...text.matchAll(/^## (.+)$/gm)];
  for (const [index, heading] of headings.entries()) {
    const start = heading.index + heading[0].length;
    const end = headings[index + 1]?.index ?? text.length;
    const body = text.slice(start, end).trim();
    const lines = body
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    sections[heading[1].trim()] =
      lines.length > 0 && lines.every((line) => line.startsWith('- '))
        ? lines.map((line) => stripInlineFormatting(line.slice(2)))
        : body;
  }
  return {
    id: topFields.get('Task ID'),
    title: topFields.get('Title'),
    worker: topFields.get('Worker'),
    start: topFields.get('Start'),
    finish: topFields.get('Finish'),
    status: topFields.get('Status'),
    disposition: topFields.get('Disposition'),
    sections,
  };
}

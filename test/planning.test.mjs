import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { renderHtmlBoard, renderMarkdownBoard, renderTodo, validatePlan } from '../tools/build-planning.mjs';

const plan = JSON.parse(await readFile(new URL('../planning/roadmap.json', import.meta.url), 'utf8'));

test('engineering roadmap has one WIP and valid acyclic dependencies', () => {
  assert.equal(validatePlan(plan), plan);
  assert.equal(plan.tasks.filter((task) => task.status === 'in_progress').length, 1);
  assert.ok(plan.tasks.every((task) => task.acceptance.length >= 3));
});

test('planning validation rejects unsafe status and dependency drift', () => {
  const duplicate = structuredClone(plan);
  duplicate.tasks[1].id = duplicate.tasks[0].id;
  assert.throws(() => validatePlan(duplicate), /duplicate task/);

  const impossibleDate = structuredClone(plan);
  impossibleDate.updatedAt = '2026-99-99';
  assert.throws(() => validatePlan(impossibleDate), /must be a real YYYY-MM-DD date/);

  const extraWip = structuredClone(plan);
  extraWip.tasks.find((task) => task.status === 'ready').status = 'in_progress';
  assert.throws(() => validatePlan(extraWip), /exactly one task must be in_progress/);

  const staleReady = structuredClone(plan);
  const ready = staleReady.tasks.find((task) => task.status === 'ready');
  ready.dependsOn = ['THREAT-001'];
  assert.throws(() => validatePlan(staleReady), /dependency THREAT-001 is not done/);

  const falseGate = structuredClone(plan);
  falseGate.releaseGates.find((gate) => gate.id === 'G1').status = 'passed';
  assert.throws(() => validatePlan(falseGate), /G1 status does not match its checks/);
});

test('generated Chinese board is offline, CSP constrained and free of inline script', () => {
  const html = renderHtmlBoard(plan);
  assert.match(html, /<html lang="zh-CN">/);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /<script src="\.\/task-board\.js" defer><\/script>/);
  assert.doesNotMatch(html, /<script(?:\s[^>]*)?>\s*(?!<\/script>)/);
  assert.doesNotMatch(html, /https?:\/\//);
  assert.match(html, /Robinhood Chain Testnet/);
});

test('generated artifacts match the canonical roadmap', async () => {
  const actualTodo = await readFile(new URL('../TODO.md', import.meta.url), 'utf8');
  const actualMarkdown = await readFile(new URL('../docs/TASK-BOARD.md', import.meta.url), 'utf8');
  const actualHtml = await readFile(new URL('../docs/task-board.html', import.meta.url), 'utf8');
  assert.equal(actualTodo, renderTodo(plan));
  assert.equal(actualMarkdown, renderMarkdownBoard(plan));
  assert.equal(actualHtml, renderHtmlBoard(plan));
});

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));

export function renderForumPage(template, app, snapshot) {
  const replacements = {
    __AF_SNAPSHOT__: JSON.stringify(snapshot).replaceAll('<', '\\u003c'),
    __AF_APP__: app,
  };
  let html = template;
  for (const [placeholder, value] of Object.entries(replacements)) {
    if (html.split(placeholder).length !== 2)
      throw new Error(`Forum template placeholder invalid: ${placeholder}`);
    html = html.replace(placeholder, () => value);
  }
  return html;
}

export async function build({ check = false } = {}) {
  const read = (path) => readFile(resolve(root, path), 'utf8');
  const [template, app, snapshotText, css] = await Promise.all([
    read('tools/agent-forum.template.html'),
    read('tools/agent-forum-app.js'),
    read('docs/management/agents/forum-snapshot.json'),
    read('tools/agent-forum.css'),
  ]);
  const html = renderForumPage(template, './agent-forum-app.js', JSON.parse(snapshotText));
  const outputs = {
    'docs/management/dashboard/agent-forum.html': html,
    'docs/management/dashboard/agent-forum-app.js': app,
    'docs/management/dashboard/agent-forum.css': css,
  };
  for (const [path, content] of Object.entries(outputs)) {
    if (check) {
      if ((await read(path)) !== content) throw new Error('Agent Forum generated asset is stale');
    } else {
      await writeFile(resolve(root, path), content, 'utf8');
    }
  }
  if (!check) console.log('Generated Agent Forum assets under the existing dashboard CSP.');
  return html;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await build({ check: process.argv.includes('--check') });

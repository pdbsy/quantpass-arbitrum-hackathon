import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { analyzeHtmlSource } from './html-source-ranges.mjs';
export const normalizeStyles = (text) => text.replace(/(\s)style=/g, '$1data-user-style=');
export async function importUserUI(source, output, assetOutput = join(output, 'public')) {
  const ranges = analyzeHtmlSource(source);
  const styles = ranges.styles;
  const scripts = ranges.scripts.filter((script) => script.kind === 'inline');
  if (styles.length !== 1 || scripts.length !== 1) throw new Error('EXPECTED_ONE_STYLE_AND_SCRIPT');
  // Extraction intentionally supports attribute-free classic script/style only.
  // Dropping type, nomodule, media, nonce, etc. could change the emitted program.
  if (Object.keys(styles[0].attributes).length || Object.keys(scripts[0].attributes).length)
    throw new Error('Unsupported prototype extraction attributes');
  let shell = source;
  const replacements = [
    { ...styles[0], replacement: '<link rel="stylesheet" href="/user-ui.css">' },
    {
      ...scripts[0],
      replacement:
        '<script src="/user-ui.js"></script>\n<script type="module" src="/src/product-ui.ts"></script>',
    },
  ].sort((a, b) => b.start - a.start);
  for (const range of replacements)
    shell = shell.slice(0, range.start) + range.replacement + shell.slice(range.end);
  shell = normalizeStyles(shell);
  await mkdir(assetOutput, { recursive: true });
  await writeFile(join(assetOutput, 'user-ui.css'), styles[0].text);
  await writeFile(join(assetOutput, 'user-ui.js'), normalizeStyles(scripts[0].text));
  await writeFile(join(output, 'index.html'), shell);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await importUserUI(
    await readFile(process.argv[2] || 'apps/web/prototype/AlphaForge_v3_EN.html', 'utf8'),
    process.argv[3] || 'apps/web',
    process.argv[4] || 'build/ui-import',
  );
}

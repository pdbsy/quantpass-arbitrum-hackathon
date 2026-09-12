import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
export const normalizeStyles = (text) => text.replace(/(\s)style=/g, '$1data-user-style=');
export async function importUserUI(source, output, assetOutput = join(output, 'public')) {
  const styles = [...source.matchAll(/<style>([\s\S]*?)<\/style>/g)];
  const scripts = [...source.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  if (styles.length !== 1 || scripts.length !== 1) throw new Error('EXPECTED_ONE_STYLE_AND_SCRIPT');
  const shell = normalizeStyles(
    source
      .replace(styles[0][0], '<link rel="stylesheet" href="/user-ui.css">')
      .replace(
        scripts[0][0],
        '<script src="/user-ui.js"></script>\n<script type="module" src="/src/product-ui.ts"></script>',
      ),
  );
  await mkdir(assetOutput, { recursive: true });
  await writeFile(join(assetOutput, 'user-ui.css'), styles[0][1]);
  await writeFile(join(assetOutput, 'user-ui.js'), normalizeStyles(scripts[0][1]));
  await writeFile(join(output, 'index.html'), shell);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await importUserUI(
    await readFile(process.argv[2] || 'apps/web/prototype/AlphaForge_v3_EN.html', 'utf8'),
    process.argv[3] || 'apps/web',
    process.argv[4] || 'build/ui-import',
  );
}

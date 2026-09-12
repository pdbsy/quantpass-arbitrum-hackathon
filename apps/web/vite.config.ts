import { readFile } from 'node:fs/promises';
import { defineConfig } from 'vite';
export default defineConfig({
  publicDir: '../../docs',
  plugins: [
    {
      name: 'alphaforge-user-ui-assets',
      async generateBundle() {
        for (const fileName of ['user-ui.css', 'user-ui.js']) {
          this.emitFile({
            type: 'asset',
            fileName,
            source: await readFile(new URL(`../../build/ui-import/${fileName}`, import.meta.url)),
          });
        }
      },
    },
  ],
  build: { outDir: 'dist', sourcemap: false },
  server: { host: '127.0.0.1' },
});

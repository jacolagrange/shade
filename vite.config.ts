import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

/** Emits sw.js with the list of built files to precache and a content-based version. */
function serviceWorker(): Plugin {
  return {
    name: 'shade-service-worker',
    apply: 'build',
    generateBundle(_, bundle) {
      const hash = createHash('sha256');
      for (const [name, file] of Object.entries(bundle)) {
        hash.update(name);
        hash.update(file.type === 'chunk' ? file.code : file.source);
      }
      const publicFiles = readdirSync('public');
      for (const f of publicFiles) hash.update(readFileSync(`public/${f}`));

      const assets = ['./', ...Object.keys(bundle).filter((f) => f !== 'index.html'), ...publicFiles];
      const source = readFileSync('src/sw.js', 'utf8')
        .replace('__VERSION__', hash.digest('hex').slice(0, 12))
        .replace('__ASSETS__', JSON.stringify(assets));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  // Relative paths so the build works from any folder, e.g. GitHub Pages' /shade/.
  base: './',
  plugins: [serviceWorker()],
});

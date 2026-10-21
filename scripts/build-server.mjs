import { build } from 'esbuild';
import { buildMetadata } from './build-metadata.mjs';

await build({
  entryPoints: ['src/server/main.ts'],
  bundle: true,
  define: { __BUILD_INFO__: JSON.stringify(buildMetadata()) },
  platform: 'node',
  format: 'esm',
  target: 'node24',
  sourcemap: true,
  outfile: 'dist/server/main.mjs',
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});

await build({
  entryPoints: ['scripts/backup-database.mjs'], bundle: true, platform: 'node', format: 'esm',
  target: 'node24', outfile: 'dist/tools/backup-database.mjs',
});

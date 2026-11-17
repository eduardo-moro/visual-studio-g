import * as esbuild from 'esbuild';
import { readdirSync } from 'fs';

const watch = process.argv.includes('--watch');
const tests = process.argv.includes('--tests');

const common = { bundle: true, platform: 'node', target: 'node18', format: 'cjs', sourcemap: true, logLevel: 'info' };

const builds = tests
  ? [{
      ...common,
      entryPoints: readdirSync('test').filter((f) => f.endsWith('.test.ts')).map((f) => `test/${f}`),
      outdir: 'out-test',
      logLevel: 'warning',
    }]
  : [
      { ...common, entryPoints: ['src/extension.ts'], outfile: 'dist/extension.js', external: ['vscode'] },
      { ...common, entryPoints: ['src/cli.ts'], outfile: 'dist/cli.js' },
    ];

for (const b of builds) {
  if (watch) await (await esbuild.context(b)).watch();
  else await esbuild.build(b);
}

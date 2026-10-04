// Bundles the block into one file the way Activepieces pieces are shipped, then packs a .tgz to upload
// (Activepieces → Platform Admin → Pieces → Install Piece → upload file).
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import fs from 'node:fs';

fs.rmSync('dist', { recursive: true, force: true });
// keepNames: Activepieces finds the piece by its class name "Piece", so minifying must not rename it
const icon = 'data:image/svg+xml;base64,' + fs.readFileSync('../../../public/brand/stint-icon.svg').toString('base64');
await build({ define: { STINT_ICON: JSON.stringify(icon) }, entryPoints: ['src/index.ts'], bundle: true, platform: 'node', target: 'node18', format: 'cjs', outfile: 'dist/src/index.js', minify: true, keepNames: true, logLevel: 'warning' });
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
fs.writeFileSync('dist/package.json', JSON.stringify({ name: pkg.name, version: pkg.version, main: './src/index.js', dependencies: {} }, null, 2));
console.log(execSync('npm pack --silent', { cwd: 'dist' }).toString().trim());

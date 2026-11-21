import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

const webRoot = resolve('dist/web');
const html = await readFile(resolve(webRoot, 'index.html'), 'utf8');
const entryMatch = html.match(/<script[^>]+src="\/assets\/(index-[^"]+\.js)"/);
if (!entryMatch) throw new Error('Could not identify the production web entry bundle.');

const entryPath = resolve(webRoot, 'assets', entryMatch[1]);
const entryBytes = (await stat(entryPath)).size;
const maximumEntryBytes = 250 * 1024;
if (entryBytes > maximumEntryBytes) {
  throw new Error(
    `Main web bundle is ${(entryBytes / 1024).toFixed(2)} KiB; budget is ${maximumEntryBytes / 1024} KiB.`,
  );
}

process.stdout.write(`Web bundle budget passed: ${(entryBytes / 1024).toFixed(2)} KiB / 250 KiB.\n`);

// Only styles linked by the shell count here. Section styles stay lazy, so
// opening unrelated screens does not fetch the collection board presentation.
const initialStyles = [...html.matchAll(/<link[^>]+href="\/assets\/([^"/]+\.css)"/g)];
if (!initialStyles.length) throw new Error('Could not identify the initial stylesheets.');
let styleBytes = 0;
for (const match of initialStyles) styleBytes += (await stat(resolve(webRoot, 'assets', match[1]))).size;
if (styleBytes > 450 * 1024)
  throw new Error(`Initial styles are ${(styleBytes / 1024).toFixed(2)} KiB; budget is 450 KiB.`);
process.stdout.write(`Initial stylesheet budget passed: ${(styleBytes / 1024).toFixed(2)} KiB / 450 KiB.\n`);

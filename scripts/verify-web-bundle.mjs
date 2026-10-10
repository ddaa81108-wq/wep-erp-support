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

// The repository is TypeScript: no `.js`, `.mjs` or `.cjs` source may live anywhere in it. The demo
// maths bundle and the portal are build products of `dist/`, never sources.
import { pathToFileURL } from 'node:url';
import { repositoryFiles } from './repository-files.ts';

const JAVASCRIPT = /\.[cm]?js$/;

/** The maintained files written in JavaScript: none is allowed. */
export function javascriptFiles(files: string[]): string[] {
  return files.filter((file) => JAVASCRIPT.test(file));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const found = repositoryFiles();
  if (!found) throw new Error('Not a Git repository.');
  const files = javascriptFiles(found);
  if (files.length) {
    console.error(`The repository is TypeScript; these files are JavaScript:\n${files.join('\n')}`);
    process.exitCode = 1;
  } else console.log('No JavaScript source in the repository.');
}

// The site is TypeScript: no `.js`, `.mjs` or `.cjs` source may live under `site/`. The demo
// maths bundle and the portal are build products of `dist/site/`, never sources.
import { pathToFileURL } from 'node:url';
import { repositoryFiles } from './repository-files.mjs';

const JAVASCRIPT = /\.[cm]?js$/;

/** The maintained files under `site/` written in JavaScript: none is allowed. */
export function javascriptSiteFiles(files) {
  return files.filter((file) => file.startsWith('site/') && JAVASCRIPT.test(file));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = javascriptSiteFiles(repositoryFiles());
  if (files.length) {
    console.error(`The site is TypeScript; these files are JavaScript:\n${files.join('\n')}`);
    process.exitCode = 1;
  } else console.log('No JavaScript source under site/.');
}

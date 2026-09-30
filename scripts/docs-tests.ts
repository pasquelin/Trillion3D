import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { candidates, importFacts } from './import-facts.ts';
import { repositoryFiles } from './repository-files.ts';
import { isUnitTest, runUnitTests } from './unit-tests.ts';

// The unit tests that read documentation, site translations or example thumbnails: a change of
// those files alone skips the build, the type check and the rest of the suite, but still runs these
// (`check:changed` locally, `test:docs` in the CI's `quick` job) (#1348). The set is found, never
// listed: a test is in it when it, or a script or site module it imports, names such a file in a
// string, so a new reader joins it by itself. The engine (`packages/`) reads no documentation.

/** A string that names documentation: Markdown, a `docs/` path, a translation folder, the example
 *  thumbnails, the published reports and their images, or the pull request template. The notices ship in the package, and are code. */
const documentPath =
  /(?:(?<!THIRD_PARTY_NOTICES)\.md$|(?:^|\/)docs(?:\/|$)|(?:^|\/)i18n\/|(?:^|\/)thumbnails(?:\/|$)|(?:^|\/)site\/reports(?:\/|$)|PULL_REQUEST_TEMPLATE)/;
/** A module path: an import of code reads no documentation, whatever its folder. */
const modulePath = /\.(?:[cm]?[jt]sx?)$/;

/** The strings of `content` (import paths included, comments not) that name documentation. */
export function documentReads(file: string, content: string): string[] {
  const reads: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node)) &&
      documentPath.test(node.text) &&
      !modulePath.test(node.text)
    )
      reads.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile(file, content, ts.ScriptTarget.Latest, false));
  return reads;
}

/** The unit tests among `paths` that read documentation, themselves or through the script and site
 *  modules they import; `read` gives a file's source, undefined when it does not exist. */
export function documentationTests(
  paths: readonly string[],
  read = (file: string): string | undefined =>
    existsSync(file) ? readFileSync(file, 'utf8') : undefined,
): string[] {
  const sources = new Map<string, string | undefined>();
  const source = (file: string): string | undefined => {
    if (!sources.has(file)) sources.set(file, read(file));
    return sources.get(file);
  };
  const reads = new Map<string, boolean>();
  const imports = new Map<string, string[]>();
  const scan = (file: string): string[] => {
    if (!imports.has(file)) {
      const content = source(file) ?? '';
      reads.set(file, documentReads(file, content).length > 0);
      imports.set(
        file,
        importFacts(file, content).imports.flatMap(({ specifier }) => {
          const next = candidates(file, specifier).find(
            (name) => modulePath.test(name) && source(name) !== undefined,
          );
          return next && !next.startsWith('packages/') ? [next] : [];
        }),
      );
    }
    return imports.get(file)!;
  };
  return paths.filter((test) => {
    if (!isUnitTest(test)) return false;
    const seen = new Set([test]);
    const queue = [test];
    for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
      const next = scan(file);
      if (reads.get(file)) return true;
      for (const module of next)
        if (!seen.has(module)) {
          seen.add(module);
          queue.push(module);
        }
    }
    return false;
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const tests = documentationTests(repositoryFiles() ?? []);
  console.log(`Tests that read documentation: ${tests.length}`);
  runUnitTests(tests);
}

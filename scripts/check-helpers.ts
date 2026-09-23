// The small-helper check the block detector cannot do: a two-line `dot` copied into a second module
// stays under any block threshold. A free function of the same name, the same signature and the
// same body — comments and layout aside — defined in two non-test modules of one package or crate
// is a copy, reported with the module that should own it. The body is compared too: a driver's
// `convert` or a codec's `encode` share a name and a signature with their siblings by design and
// hold different code. `pnpm run check:helpers`; `scripts/check-helpers.test.ts` plants a copy.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { cfgTestModules, rsHelpers } from './check-helpers-rust.ts';
import { repositoryFiles } from './repository-files.ts';

/** Each package or crate is its own namespace: a helper is owned once per unit. */
export const UNITS = [
  'packages/sdk-core/src',
  'packages/sdk-browser/src',
  'packages/sdk-node/src',
  'packages/page-codec',
  'packages/asset-compiler-rust/src',
  'packages/page-codec-wasm/src',
];

export interface Helper {
  name: string;
  signature: string;
  body: string;
  file: string;
}

const TEST_TS = /\.(?:test|fixture|perf|browser)\.m?ts$/;
const TEST_RS = /(?:^|\/)(?:tests?|\w+_tests?)(?:\.rs$|\/)/;

/** Whether `file` is a test module, which may keep its own small copies. */
export const isTestModule = (file: string) =>
  file.endsWith('.rs') ? TEST_RS.test(file) : TEST_TS.test(file);

/** The helpers a TypeScript module defines at its top level, read by the compiler: a function
 *  declaration, or a `const` bound to an arrow or a function expression. */
function tsHelpers(file: string, text: string): Helper[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const printer = ts.createPrinter({ removeComments: true });
  const flat = (node: ts.Node | undefined) =>
    node ? printer.printNode(ts.EmitHint.Unspecified, node, source).replace(/\s+/g, '') : '';
  const out: Helper[] = [];
  const add = (name: string, fn: ts.FunctionLikeDeclaration, declared?: ts.TypeNode) => {
    if (!fn.body) return;
    const async = fn.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ? 'async' : '';
    const types = (fn.typeParameters ?? []).map(flat).join(',');
    const params = fn.parameters
      .map(
        (p) =>
          `${p.dotDotDotToken ? '...' : ''}${p.questionToken ? '?' : ''}${flat(p.type) || '?'}`,
      )
      .join(',');
    const signature = `${async}<${types}>(${params})=>${flat(fn.type)}:${flat(declared)}`;
    out.push({ name, signature, body: flat(fn.body), file });
  };
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) add(statement.name.text, statement);
    if (!ts.isVariableStatement(statement)) continue;
    for (const { name, initializer, type } of statement.declarationList.declarations)
      if (
        ts.isIdentifier(name) &&
        initializer &&
        (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
      )
        add(name.text, initializer, type);
  }
  return out;
}

/** Every helper of `files` (path -> text) defined twice, signature and body alike, in one unit. */
export function duplicateHelpers(files: Map<string, string>): Helper[][] {
  const seen = new Map<string, Helper[]>();
  const testOnly = cfgTestModules(files);
  for (const [file, text] of files) {
    const unit = UNITS.find((u) => file.startsWith(u + '/'));
    if (!unit || isTestModule(file.slice(unit.length))) continue;
    if (testOnly.some((path) => file === path || (path.endsWith('/') && file.startsWith(path))))
      continue;
    const helpers = file.endsWith('.rs') ? rsHelpers(file, text) : tsHelpers(file, text);
    for (const helper of helpers) {
      if (helper.name === 'main' || helper.name === 'default') continue;
      const key = `${unit}\0${helper.name}\0${helper.signature}\0${helper.body}`;
      seen.set(key, [...(seen.get(key) ?? []), helper]);
    }
  }
  return [...seen.values()].filter((group) => new Set(group.map((h) => h.file)).size > 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = resolve(import.meta.dirname, '..');
  const tracked = repositoryFiles(root);
  if (!tracked) throw new Error('Not a Git repository.');
  const files = new Map(
    tracked
      .filter((file) => /\.(?:m?ts|rs)$/.test(file))
      .map((file): [string, string] => [file, readFileSync(join(root, file), 'utf8')]),
  );
  const groups = duplicateHelpers(files);
  for (const group of groups)
    console.error(
      `${group[0].name}${group[0].signature} is defined in ${group.map((h) => h.file).join(', ')}: ` +
        `keep it in ${group[0].file} and import it`,
    );
  if (groups.length) process.exitCode = 1;
  else console.log('No small helper is defined twice within one package.');
}

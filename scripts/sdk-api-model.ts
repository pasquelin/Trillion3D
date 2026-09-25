import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import prettier from 'prettier';
import ts from 'typescript';
import { repositoryFiles } from './repository-files.ts';

export const ROOT = resolve(import.meta.dirname, '..');
export const ENTRIES = {
  core: 'packages/sdk-core/src/index.ts',
  browser: 'packages/sdk-browser/src/index.ts',
  node: 'packages/sdk-node/src/index.mts',
} as const;
export type ExportEntry = keyof typeof ENTRIES;
/** The published facade of `trillion3d` (`package.json` exports), one file per condition: what a
 *  consumer imports, the entries above plus the symbols the facade adds (`sdk-api-documented.ts`). */
export const PUBLIC_ENTRIES: Record<ExportEntry, string> = {
  core: 'packages/sdk/index.ts',
  browser: 'packages/sdk/browser.ts',
  node: 'packages/sdk/node.mts',
};
type ExportKind = 'value' | 'type' | 'both';

export interface ExportRow {
  name: string;
  kind: ExportKind;
  module: string;
  entries: ExportEntry[];
  identity: string;
  disposition?: string;
  consumers?: string[];
}

function exportKind(symbol: ts.Symbol, checker: ts.TypeChecker): ExportKind {
  const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  const value = Boolean(target.flags & ts.SymbolFlags.Value);
  const type = Boolean(target.flags & ts.SymbolFlags.Type);
  return value && type ? 'both' : value ? 'value' : 'type';
}

function definingModule(symbol: ts.Symbol, checker: ts.TypeChecker): string {
  const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  const file = target.declarations?.[0]?.getSourceFile().fileName;
  return file ? relative(ROOT, file) : 'unknown';
}

let program: ts.Program | undefined;
/** One program over the entry files and the published facade, built once per process: the
 *  checker the facade, the export inventory and the reference all read. */
export function apiProgram(): ts.Program {
  const files = [...Object.values(ENTRIES), ...Object.values(PUBLIC_ENTRIES)];
  program ??= ts.createProgram(
    files.map((file) => join(ROOT, file)),
    {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      strict: true,
      skipLibCheck: true,
      types: ['node', '@webgpu/types'],
    },
  );
  return program;
}

/** The module symbol of each entry file, in the order `entries` lists them. */
export function entryModules(
  program: ts.Program,
  entries: Record<ExportEntry, string> = ENTRIES,
): [ExportEntry, ts.Symbol][] {
  const checker = program.getTypeChecker();
  // `Object.entries` always widens object keys to `string`: the entry names are `ExportEntry`.
  return (Object.entries(entries) as [ExportEntry, string][]).map(([entry, file]) => {
    const source = program.getSourceFile(join(ROOT, file));
    const module = source && checker.getSymbolAtLocation(source);
    if (!module) throw new Error(`Cannot resolve ${file}`);
    return [entry, module];
  });
}

export function analyzeEntries(): ExportRow[] {
  const program = apiProgram();
  const checker = program.getTypeChecker();
  const rows = new Map<string, ExportRow>();
  for (const [entry, module] of entryModules(program)) {
    for (const symbol of checker.getExportsOfModule(module)) {
      const target =
        symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
      const key = `${symbol.name}\0${definingModule(symbol, checker)}`;
      const row = rows.get(key) ?? {
        name: symbol.name,
        kind: exportKind(symbol, checker),
        module: definingModule(symbol, checker),
        entries: [],
        identity: checker
          .getFullyQualifiedName(target)
          .replace(`${ROOT.replaceAll('\\', '/')}/`, ''),
      };
      row.entries.push(entry);
      rows.set(key, row);
    }
  }
  return [...rows.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.module.localeCompare(b.module),
  );
}

export function consumerImports(root = ROOT): Map<string, Set<string>> {
  const consumers = new Map<string, Set<string>>();
  const found = repositoryFiles(root);
  if (!found) throw new Error('Not a Git repository.');
  for (const path of found.filter((file) => /\.(?:[cm]?[jt]sx?)$/.test(file))) {
    const file = join(root, path);
    const source = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    for (const node of source.statements) {
      if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) continue;
      const clause = node.importClause;
      const specifier = node.moduleSpecifier.text;
      const publicEntry = specifier === 'trillion3d';
      const internalEntry =
        specifier.includes('/sdk-core/') ||
        specifier.includes('/sdk-browser/') ||
        specifier.includes('/sdk-node/');
      if (!publicEntry && !internalEntry) continue;
      if (clause?.name) addConsumer(consumers, 'default', path);
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings))
        for (const element of bindings.elements)
          addConsumer(consumers, element.propertyName?.text ?? element.name.text, path);
    }
  }
  return consumers;
}

function addConsumer(consumers: Map<string, Set<string>>, name: string, file: string): void {
  const paths = consumers.get(name) ?? new Set<string>();
  paths.add(file);
  consumers.set(name, paths);
}

/**
 * Writes a generated file, formatted by the repository's Prettier settings; with `check` (by
 * default, `--check` on the command line), fails instead when the file on disk differs from what
 * would be written. A file git never tracks is always written: there is nothing to compare it to.
 */
export async function writeGenerated(
  path: string,
  content: string,
  check = process.argv.includes('--check'),
): Promise<void> {
  const absolute = join(ROOT, path);
  const prettierConfig = await prettier.resolveConfig(absolute);
  const formatted = await prettier.format(content, { ...prettierConfig, filepath: absolute });
  mkdirSync(dirname(absolute), { recursive: true });
  if (!check) writeFileSync(absolute, formatted);
  else if (readFileSync(absolute, 'utf8') !== formatted) {
    const [was, now] = [readFileSync(absolute, 'utf8').split('\n'), formatted.split('\n')];
    const at = was.findIndex((line, index) => line !== now[index]);
    throw new Error(`${path} is stale at line ${at + 1}:\n- ${was[at]}\n+ ${now[at]}`);
  }
}

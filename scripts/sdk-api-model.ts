import { readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { repositoryFiles } from './repository-files.ts';

export const ROOT = resolve(import.meta.dirname, '..');
export const ENTRIES = {
  core: 'packages/sdk-core/src/index.ts',
  browser: 'packages/sdk-browser/src/index.ts',
  node: 'packages/sdk-node/src/index.mts',
} as const;
export type ExportEntry = keyof typeof ENTRIES;
export type ExportKind = 'value' | 'type' | 'both';

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

export function analyzeEntries(): ExportRow[] {
  const files = Object.values(ENTRIES).map((file) => join(ROOT, file));
  const program = ts.createProgram(files, {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true,
    skipLibCheck: true,
    types: ['node', '@webgpu/types'],
  });
  const checker = program.getTypeChecker();
  const rows = new Map<string, ExportRow>();
  // `Object.entries` always widens object keys to `string`: the entry names are known from `ENTRIES`.
  for (const [entry, file] of Object.entries(ENTRIES) as [ExportEntry, string][]) {
    const source = program.getSourceFile(join(ROOT, file));
    const module = source && checker.getSymbolAtLocation(source);
    if (!module) throw new Error(`Cannot resolve ${file}`);
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
      const publicEntry = specifier === 'web-geometry';
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

import { readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { repositoryFiles } from './repository-files.mjs';

export const ROOT = resolve(import.meta.dirname, '..');
export const ENTRIES = {
  core: 'packages/sdk-core/index.ts',
  browser: 'packages/sdk-browser/index.ts',
  node: 'packages/sdk-node/index.mts',
};

function exportKind(symbol, checker) {
  const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  const value = Boolean(target.flags & ts.SymbolFlags.Value);
  const type = Boolean(target.flags & ts.SymbolFlags.Type);
  return value && type ? 'both' : value ? 'value' : 'type';
}

function definingModule(symbol, checker) {
  const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  const file = target.declarations?.[0]?.getSourceFile().fileName;
  return file ? relative(ROOT, file) : 'unknown';
}

export function analyzeEntries() {
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
  const rows = new Map();
  for (const [entry, file] of Object.entries(ENTRIES)) {
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

export function consumerImports(root = ROOT) {
  const consumers = new Map();
  for (const path of repositoryFiles(root).filter((file) => /\.(?:[cm]?[jt]sx?)$/.test(file))) {
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
      const publicEntry = specifier.startsWith('@web-geometry/sdk');
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

function addConsumer(consumers, name, file) {
  const paths = consumers.get(name) ?? new Set();
  paths.add(file);
  consumers.set(name, paths);
}

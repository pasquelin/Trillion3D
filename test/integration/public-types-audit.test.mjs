import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import ts from 'typescript';

const ROOT = resolve(import.meta.dirname, '../..');
const FACADES = ['packages/sdk/index.ts', 'packages/sdk/browser.ts', 'packages/sdk/node.mts'];

function isNamedContract(declaration) {
  return (
    ts.isInterfaceDeclaration(declaration) ||
    ts.isTypeAliasDeclaration(declaration) ||
    ts.isClassDeclaration(declaration) ||
    ts.isEnumDeclaration(declaration)
  );
}

function missingNamedContracts(file) {
  const program = ts.createProgram([resolve(ROOT, file)], {
    allowImportingTsExtensions: true,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    types: ['node', '@webgpu/types'],
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(resolve(ROOT, file));
  const module = checker.getSymbolAtLocation(source);
  const exports = checker.getExportsOfModule(module);
  const publicNames = new Set(exports.map((symbol) => symbol.name));
  const missing = new Set();

  function visit(type, depth = 0, seen = new Set()) {
    if (!type || depth > 4 || seen.has(type.id)) return;
    seen.add(type.id);
    for (const symbol of [type.aliasSymbol, type.symbol]) {
      if (!symbol || publicNames.has(symbol.name)) continue;
      const declarations = symbol.declarations ?? [];
      if (
        declarations.some(
          (declaration) =>
            isNamedContract(declaration) &&
            declaration.getSourceFile().fileName.includes('/packages/sdk-'),
        )
      )
        missing.add(symbol.name);
    }
    for (const argument of [...(type.aliasTypeArguments ?? []), ...(type.typeArguments ?? [])])
      visit(argument, depth + 1, seen);
    for (const property of checker.getPropertiesOfType(type)) {
      const declaration = property.valueDeclaration ?? property.declarations?.[0];
      if (declaration)
        visit(checker.getTypeOfSymbolAtLocation(property, declaration), depth + 1, seen);
    }
    for (const signature of [...type.getCallSignatures(), ...type.getConstructSignatures()]) {
      visit(signature.getReturnType(), depth + 1, seen);
      for (const parameter of signature.parameters) {
        const declaration = parameter.valueDeclaration ?? parameter.declarations?.[0];
        if (declaration)
          visit(checker.getTypeOfSymbolAtLocation(parameter, declaration), depth + 1, seen);
      }
    }
  }

  for (const symbol of exports) {
    const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
    if (!declaration) continue;
    const type = checker.getTypeOfSymbolAtLocation(symbol, declaration);
    for (const signature of [...type.getCallSignatures(), ...type.getConstructSignatures()]) {
      visit(signature.getReturnType());
      for (const parameter of signature.parameters) {
        const parameterDeclaration = parameter.valueDeclaration ?? parameter.declarations?.[0];
        if (parameterDeclaration)
          visit(checker.getTypeOfSymbolAtLocation(parameter, parameterDeclaration));
      }
    }
  }
  return [...missing].sort();
}

test('SDK-owned named signature contracts are reachable from every matching facade', () => {
  for (const facade of FACADES) assert.deepEqual(missingNamedContracts(facade), []);
});

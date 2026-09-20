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
  const seen = new Set();

  const sdkDeclaration = (declaration) =>
    declaration.getSourceFile().fileName.includes('/packages/sdk-');

  function visit(type) {
    if (!type || seen.has(type.id)) return;
    seen.add(type.id);
    const symbols = [type.aliasSymbol, type.symbol].filter(Boolean);
    for (const symbol of symbols) {
      if (!symbol || publicNames.has(symbol.name)) continue;
      const declarations = symbol.declarations ?? [];
      if (
        declarations.some(
          (declaration) => isNamedContract(declaration) && sdkDeclaration(declaration),
        )
      )
        missing.add(symbol.name);
    }
    for (const argument of [...(type.aliasTypeArguments ?? []), ...(type.typeArguments ?? [])])
      visit(argument);
    if (type.isUnionOrIntersection()) for (const member of type.types) visit(member);
    const declarations = symbols.flatMap((symbol) => symbol.declarations ?? []);
    if (
      declarations.length > 0 &&
      declarations.every((declaration) => !sdkDeclaration(declaration))
    )
      return;
    for (const property of checker.getPropertiesOfType(type)) {
      const declaration = property.valueDeclaration ?? property.declarations?.[0];
      if (declaration) visit(checker.getTypeOfSymbolAtLocation(property, declaration));
    }
    for (const signature of [...type.getCallSignatures(), ...type.getConstructSignatures()]) {
      visit(signature.getReturnType());
      for (const parameter of signature.parameters) {
        const declaration = parameter.valueDeclaration ?? parameter.declarations?.[0];
        if (declaration) visit(checker.getTypeOfSymbolAtLocation(parameter, declaration));
      }
    }
  }

  for (const symbol of exports) {
    const canonical =
      symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    const declaration = canonical.valueDeclaration ?? canonical.declarations?.[0];
    if (!declaration) continue;
    const type = isNamedContract(declaration)
      ? checker.getDeclaredTypeOfSymbol(canonical)
      : checker.getTypeOfSymbolAtLocation(canonical, declaration);
    visit(type);
  }
  return [...missing].sort();
}

test('SDK-owned named signature contracts are reachable from every matching facade', () => {
  for (const facade of FACADES) assert.deepEqual(missingNamedContracts(facade), []);
});

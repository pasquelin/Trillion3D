import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import ts from 'typescript';

const ROOT = resolve(import.meta.dirname, '../..');
const FACADES = ['packages/sdk/index.ts', 'packages/sdk/browser.ts', 'packages/sdk/node.mts'];

/** A named signature contract: the compiler assigns it one canonical `Type` per declaration,
 *  unlike an anonymous object type. */
type NamedContract =
  ts.InterfaceDeclaration | ts.TypeAliasDeclaration | ts.ClassDeclaration | ts.EnumDeclaration;

function isNamedContract(declaration: ts.Declaration): declaration is NamedContract {
  return (
    ts.isInterfaceDeclaration(declaration) ||
    ts.isTypeAliasDeclaration(declaration) ||
    ts.isClassDeclaration(declaration) ||
    ts.isEnumDeclaration(declaration)
  );
}

/** `Type.id`: the internal dedup key every compiler `Type` carries, absent from the public
 *  `typescript` API — there is no other way to break cycles while walking it. `typeArguments`
 *  is likewise only declared on `TypeReference`, though every `Type` may carry it. */
type TypeWithId = ts.Type & { id: number; typeArguments?: readonly ts.Type[] };

/** A `private` or `#private` member: the emitted declarations drop its type, so it reaches no
 *  caller. */
function isPrivate(declaration: ts.Declaration): boolean {
  const name = ts.getNameOfDeclaration(declaration);
  return (
    (name !== undefined && ts.isPrivateIdentifier(name)) ||
    (ts.getCombinedModifierFlags(declaration) & ts.ModifierFlags.Private) !== 0
  );
}

function missingNamedContracts(file: string): string[] {
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
  if (!source) throw new Error(`${file}: not part of the program`);
  const module = checker.getSymbolAtLocation(source);
  if (!module) throw new Error(`${file}: has no module symbol`);
  const exports = checker.getExportsOfModule(module);
  const publicNames = new Set(exports.map((symbol) => symbol.name));
  const missing = new Set<string>();
  const seen = new Set<number>();

  const sdkDeclaration = (declaration: ts.Declaration): boolean =>
    declaration.getSourceFile().fileName.includes('/packages/sdk-');

  function visit(type: ts.Type | undefined): void {
    if (!type || seen.has((type as TypeWithId).id)) return;
    seen.add((type as TypeWithId).id);
    const symbols = [type.aliasSymbol, type.symbol].filter((symbol): symbol is ts.Symbol =>
      Boolean(symbol),
    );
    for (const symbol of symbols) {
      if (publicNames.has(symbol.name)) continue;
      const declarations = symbol.declarations ?? [];
      if (
        declarations.some(
          (declaration) => isNamedContract(declaration) && sdkDeclaration(declaration),
        )
      )
        missing.add(symbol.name);
    }
    for (const argument of [
      ...(type.aliasTypeArguments ?? []),
      ...((type as TypeWithId).typeArguments ?? []),
    ])
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
      if (declaration && !isPrivate(declaration))
        visit(checker.getTypeOfSymbolAtLocation(property, declaration));
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

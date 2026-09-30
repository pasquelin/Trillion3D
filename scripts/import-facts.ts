import { posix } from 'node:path';
import ts from 'typescript';

/** One value import of a module: the names it reads, or `'*'` for the whole module (a namespace,
 *  side-effect or dynamic import). Type-only imports are left out: they run no code. */
interface ValueImport {
  specifier: string;
  names: readonly string[] | '*';
}

/** What a module imports and exports, read from its syntax alone. */
export interface ImportFacts {
  imports: ValueImport[];
  /** `export { name as alias } from`, and `export * as alias from` with `name` `'*'`. */
  reExports: { specifier: string; name: string; alias: string }[];
  /** `export * from`. */
  stars: string[];
  /** The names the module declares and exports itself. */
  locals: Set<string>;
}

const hasModifier = (node: ts.Node, modifier: ts.SyntaxKind): boolean =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some(({ kind }) => kind === modifier);

function declaredNames(node: ts.Statement): string[] {
  if (ts.isVariableStatement(node))
    return node.declarationList.declarations.flatMap(({ name }) =>
      ts.isIdentifier(name) ? [name.text] : [],
    );
  if (hasModifier(node, ts.SyntaxKind.DefaultKeyword)) return ['default'];
  const named = node as ts.Statement & { name?: ts.Node };
  return named.name && ts.isIdentifier(named.name) ? [named.name.text] : [];
}

function importNames(clause: ts.ImportClause): readonly string[] | '*' | undefined {
  if (clause.isTypeOnly) return undefined;
  const bindings = clause.namedBindings;
  if (bindings && ts.isNamespaceImport(bindings)) return '*';
  const names = (bindings?.elements ?? [])
    .filter((element) => !element.isTypeOnly)
    .map((element) => (element.propertyName ?? element.name).text);
  if (clause.name) names.push('default');
  return names.length ? names : undefined;
}

/** The value imports and the exports of `content`, parsed without a type checker. */
export function importFacts(file: string, content: string): ImportFacts {
  const facts: ImportFacts = { imports: [], reExports: [], stars: [], locals: new Set() };
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, false);
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [argument] = node.arguments;
      if (argument && ts.isStringLiteralLike(argument))
        facts.imports.push({ specifier: argument.text, names: '*' });
    }
    ts.forEachChild(node, visit);
  };
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const names = statement.importClause ? importNames(statement.importClause) : '*';
      if (names) facts.imports.push({ specifier: statement.moduleSpecifier.text, names });
    } else if (ts.isExportDeclaration(statement)) {
      if (statement.isTypeOnly) continue;
      const from = statement.moduleSpecifier;
      const clause = statement.exportClause;
      if (!from || !ts.isStringLiteral(from)) {
        if (clause && ts.isNamedExports(clause))
          for (const element of clause.elements)
            if (!element.isTypeOnly) facts.locals.add(element.name.text);
      } else if (!clause) facts.stars.push(from.text);
      else if (ts.isNamespaceExport(clause))
        facts.reExports.push({ specifier: from.text, name: '*', alias: clause.name.text });
      else
        for (const element of clause.elements)
          if (!element.isTypeOnly)
            facts.reExports.push({
              specifier: from.text,
              name: (element.propertyName ?? element.name).text,
              alias: element.name.text,
            });
    } else if (ts.isExportAssignment(statement)) facts.locals.add('default');
    else if (hasModifier(statement, ts.SyntaxKind.ExportKeyword))
      for (const name of declaredNames(statement)) facts.locals.add(name);
    visit(statement);
  }
  return facts;
}

/** The files `specifier` may name from `importer`; the package name is the public facade. */
export function candidates(importer: string, specifier: string): string[] {
  if (specifier === 'trillion3d')
    return ['packages/sdk/index.ts', 'packages/sdk/browser.ts', 'packages/sdk/node.mts'];
  if (!specifier.startsWith('.')) return [];
  const target = posix.normalize(posix.join(posix.dirname(importer), specifier));
  const stem = target.replace(/\.m?ts$/, '');
  return [target, `${stem}.ts`, `${stem}.mts`, `${stem}/index.ts`];
}

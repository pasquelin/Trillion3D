// The measurement `check-cohesion.ts` gates on, read from a map of path -> text so the gate and its
// test share one implementation.
//
// What it measures is the difficulty *inside* a function: its own line count and its cyclomatic
// complexity. A bound on the file cannot see either — a module of six one-line functions and a
// module of one hundred-line function both pass it, and only one of them is hard to change.
//
// What it deliberately does not measure is the number of declarations a module holds. The tree
// decomposes by responsibility at a fine grain and on purpose: 620 modules define at most two
// names each and are read by one, and that is an architecture, not a fragmentation. A gate on it
// would condemn the house style.
import ts from 'typescript';

/** Each package is its own namespace. */
export const UNITS = [
  'packages/sdk-core/src',
  'packages/sdk-browser/src',
  'packages/sdk-node/src',
  'packages/page-codec',
] as const;

const TEST = /\.(?:test|fixture|perf|browser)\.m?ts$/;

/** Whether `file` is a test, a fixture or a browser probe. */
export const isTestModule = (file: string) => TEST.test(file);

/** The unit a maintained file belongs to, or null when it belongs to none: the gate reads the
 *  packages and leaves the scripts, the site and the bench to the gates that own them. */
export const unitOf = (file: string) => UNITS.find((unit) => file.startsWith(unit + '/')) ?? null;

export interface Fn {
  name: string;
  line: number;
  lines: number;
  complexity: number;
}

/** McCabe: one, plus every branch that can take a path of its own. `&&`, `||` and `??` are
 *  counted too — a guard written as a boolean operator is a branch all the same. */
const BRANCH = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.DoStatement,
  ts.SyntaxKind.CaseClause,
  ts.SyntaxKind.CatchClause,
  ts.SyntaxKind.ConditionalExpression,
]);
const BOOLEAN = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
]);

const FUNCTION =
  ts.SyntaxKind.FunctionDeclaration |
  ts.SyntaxKind.MethodDeclaration |
  ts.SyntaxKind.ArrowFunction |
  ts.SyntaxKind.FunctionExpression;

/** Every function a module defines at its top level, with its own line count and its complexity. A
 *  nested function is measured as part of the one that holds it: its lines are already inside the
 *  parent's span and its branches inside the parent's complexity, so listing it again would count
 *  the same difficulty twice and let a function pass by hiding its work one closure deep. */
export function functionsOf(file: string, text: string): Fn[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const out: Fn[] = [];
  const walk = (node: ts.Node, top: boolean) => {
    if (top && node.kind & FUNCTION) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      const end = source.getLineAndCharacterOfPosition(node.end);
      let complexity = 1;
      const count = (n: ts.Node) => {
        if (BRANCH.has(n.kind)) complexity++;
        if (ts.isBinaryExpression(n) && BOOLEAN.has(n.operatorToken.kind)) complexity++;
        ts.forEachChild(n, count);
      };
      ts.forEachChild(node, count);
      out.push({
        name: functionName(node, source),
        line: line + 1,
        lines: end.line - line + 1,
        complexity,
      });
    }
    ts.forEachChild(node, (child) => walk(child, false));
  };
  for (const statement of source.statements) walk(statement, true);
  return out;
}

/** The name a function is reported under: a method or a bound arrow takes its property or variable
 *  name, an anonymous one its line, so a report always points at something a reader can find. */
function functionName(node: ts.Node, source: ts.SourceFile): string {
  if (ts.isFunctionDeclaration(node) && node.name) return node.name.text;
  const parent = node.parent;
  if (parent && ts.isPropertyDeclaration(parent) && parent.name) return propertyName(parent.name);
  if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name))
    return parent.name.text;
  return `line ${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`;
}

const propertyName = (name: ts.PropertyName) =>
  ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : '[computed]';

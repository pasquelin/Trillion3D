// The measurement `check-cohesion.ts` gates on, read from a map of path -> text so the gate and its
// test share one implementation.
//
// What it measures is the difficulty *inside* a function: its own line count and its cyclomatic
// complexity. A bound on the file cannot see either — a module of six one-line functions and a
// module of one hundred-line function both pass it, and only one of them is hard to change.
//
// What it deliberately does not measure is the number of declarations a module holds. The tree
// decomposes by responsibility at a fine grain and on purpose — `host/prepared/` alone is a dozen
// modules, one step of the scene build each, read by `build.ts` — and that is an architecture, not
// a fragmentation. A gate on it would condemn the house style.
import ts from 'typescript'

/** Each package is its own namespace. */
const UNITS = [
  'packages/sdk-core/src',
  'packages/sdk-browser/src',
  'packages/sdk-node/src',
  'packages/page-codec/src',
] as const

const TEST = /\.(?:test|fixture|perf|gpu)\.m?ts$/

/** Whether `file` is a test, a fixture or a GPU proof. */
export const isTestModule = (file: string) => TEST.test(file)

/** The unit a maintained file belongs to, or null when it belongs to none: the gate reads the
 *  packages and leaves the scripts, the site and the bench to the gates that own them. */
export const unitOf = (file: string) => UNITS.find((unit) => file.startsWith(unit + '/')) ?? null

export interface Fn {
  name: string
  line: number
  lines: number
  complexity: number
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
])
const BOOLEAN = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
  // The assigning forms take the same two paths as the operators they stand for, and counting one
  // without the other would make `a ||= b` simpler than `a || b`, which it is not.
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
])

/** The node kinds a function is. A `Set`, never a bitwise `|`: `ts.SyntaxKind` members are
 *  ordinals, not flags, so `FunctionDeclaration | MethodDeclaration` is 511 and matches every kind
 *  below it — a class, an interface, a variable statement. A method belongs here: a class whose
 *  methods are long and branching is exactly what this gate is for, and measuring the class
 *  declaration instead would miss all of them. */
const FUNCTION: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.Constructor,
  ts.SyntaxKind.GetAccessor,
  ts.SyntaxKind.SetAccessor,
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.FunctionExpression,
])

/** Every function a module defines at its top level, with its own line count and its complexity. A
 *  nested function is measured as part of the one that holds it: its lines are already inside the
 *  parent's span and its branches inside the parent's complexity, so listing it again would count
 *  the same difficulty twice and let a function pass by hiding its work one closure deep. */
export function functionsOf(file: string, text: string): Fn[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const out: Fn[] = []
  // A function is measured wherever it is defined: at the top level of the module, or inside a
  // class, an object literal or a namespace. Only a function written inside another function is
  // left to its parent, which already spans it.
  const walk = (node: ts.Node, top: boolean) => {
    if ((top || !insideFunction(node)) && FUNCTION.has(node.kind)) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source))
      const end = source.getLineAndCharacterOfPosition(node.end)
      let complexity = 1
      const count = (n: ts.Node) => {
        if (BRANCH.has(n.kind)) complexity++
        if (ts.isBinaryExpression(n) && BOOLEAN.has(n.operatorToken.kind)) complexity++
        ts.forEachChild(n, count)
      }
      ts.forEachChild(node, count)
      out.push({
        name: functionName(node, source),
        line: line + 1,
        lines: end.line - line + 1,
        complexity,
      })
    }
    ts.forEachChild(node, (child) => walk(child, false))
  }
  for (const statement of source.statements) walk(statement, true)
  return out
}

/** Whether `node` sits inside a function body, and so belongs to the one that holds it. A class
 *  method is not: a class is not a function, and its methods are the only way to reach it. */
function insideFunction(node: ts.Node): boolean {
  for (let at = node.parent; at; at = at.parent) if (FUNCTION.has(at.kind)) return true
  return false
}

/** The name a function is reported under: a method or an accessor takes its own name, an arrow or a
 *  function expression the variable or property it is bound to, and an anonymous one its line — a
 *  report that could only say "line 51" would send a reader to the function rather than to its
 *  name. */
function functionName(node: ts.Node, source: ts.SourceFile): string {
  if (ts.isFunctionDeclaration(node) && node.name) return node.name.getText(source)
  if (ts.isMethodDeclaration(node) && node.name) return node.name.getText(source)
  if (ts.isConstructorDeclaration(node)) return 'constructor'
  // A getter and a setter share a name in the class; the report must not send a reader to the
  // wrong line of the pair.
  if (ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) {
    const accessor = node as ts.GetAccessorDeclaration
    if (accessor.name)
      return `${ts.isSetAccessorDeclaration(node) ? 'set' : 'get'} ${accessor.name.getText(source)}`
  }
  // A function expression is named on the property or the variable it is bound to. The walk stops at
  // the statement that holds it: a function passed straight to a call or a branch has no name to
  // give, and reaching past that would attribute it to some unrelated binding further out.
  for (let at: ts.Node | undefined = node; at; at = at.parent) {
    if (ts.isVariableDeclaration(at) && ts.isIdentifier(at.name)) return at.name.text
    if (ts.isPropertyAssignment(at) || ts.isPropertyDeclaration(at))
      return propertyName((at as ts.PropertyAssignment | ts.PropertyDeclaration).name)
    if (
      ts.isVariableStatement(at) ||
      ts.isExpressionStatement(at) ||
      ts.isReturnStatement(at) ||
      ts.isBlock(at)
    )
      break
  }
  return `line ${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`
}

const propertyName = (name: ts.PropertyName) =>
  ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : '[computed]'

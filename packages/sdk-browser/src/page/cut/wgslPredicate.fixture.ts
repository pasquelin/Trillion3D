/**
 * Runs a pure WGSL predicate in Node: `fn name(a:bool,b:f32,…)->bool{return <expression>;}`, the
 * expression made of its parameters, `!`, `&&`, `||`, comparisons and parentheses. Nothing else
 * parses — a literal, a call, a field or an arithmetic operator throws — so what runs is the WGSL
 * text itself, never a second copy of it. `f32` arguments are rounded to f32 first, as the kernel
 * receives them; comparisons of two f32 values then agree with the GPU's.
 */
type Value = boolean | number;
type Node = (args: readonly Value[]) => Value;

const TOKEN = /\s*(&&|\|\||<=|>=|==|!=|[<>!()]|[A-Za-z_][A-Za-z0-9_]*)/y;
const COMPARE: Record<string, (a: number, b: number) => boolean> = {
  '<': (a, b) => a < b,
  '>': (a, b) => a > b,
  '<=': (a, b) => a <= b,
  '>=': (a, b) => a >= b,
  '==': (a, b) => a === b,
  '!=': (a, b) => a !== b,
};

function tokens(text: string) {
  const out: string[] = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < text.length) {
    const at = TOKEN.lastIndex,
      match = TOKEN.exec(text);
    if (!match) {
      if (!text.slice(at).trim()) break;
      throw new Error(`WGSL_PREDICATE_TOKEN: ${text.slice(at, at + 12)}`);
    }
    out.push(match[1]);
  }
  return out;
}

/** Recursive descent, loosest first: `||`, `&&`, comparison, `!`, then a parameter or a group. */
function parse(list: readonly string[], params: readonly string[]): Node {
  let at = 0;
  const take = (token: string) => list[at] === token && (at++, true);
  const primary = (): Node => {
    if (take('!')) {
      const inner = primary();
      return (args) => !inner(args);
    }
    if (take('(')) {
      const inner = or();
      if (!take(')')) throw new Error('WGSL_PREDICATE_PAREN');
      return inner;
    }
    const index = params.indexOf(list[at++]);
    if (index < 0) throw new Error(`WGSL_PREDICATE_NAME: ${list[at - 1]}`);
    return (args) => args[index];
  };
  const compare = (): Node => {
    const left = primary(),
      op = COMPARE[list[at]];
    if (!op) return left;
    at++;
    const right = primary();
    return (args) => op(left(args) as number, right(args) as number);
  };
  const chain = (
    token: string,
    next: () => Node,
    join: (a: boolean, b: () => boolean) => boolean,
  ) => {
    let node = next();
    while (take(token)) {
      const left = node,
        right = next();
      node = (args) => join(left(args) as boolean, () => right(args) as boolean);
    }
    return node;
  };
  const and = () => chain('&&', compare, (a, b) => a && b());
  const or = (): Node => chain('||', and, (a, b) => a || b());
  const root = or();
  if (at !== list.length) throw new Error(`WGSL_PREDICATE_TRAILING: ${list[at]}`);
  return root;
}

export function wgslPredicate(source: string, name: string) {
  const match = new RegExp(`fn ${name}\\(([^)]*)\\)->bool\\{\\s*return ([^;]+);\\s*\\}`).exec(
    source,
  );
  if (!match) throw new Error(`WGSL_PREDICATE_MISSING: ${name}`);
  const params = match[1].split(',').map((param) => param.trim().split(':'));
  for (const [, type] of params)
    if (type !== 'bool' && type !== 'f32') throw new Error(`WGSL_PREDICATE_TYPE: ${type}`);
  const body = parse(
    tokens(match[2]),
    params.map(([id]) => id),
  );
  return (...args: Value[]) =>
    body(args.map((value, i) => (params[i][1] === 'f32' ? Math.fround(value as number) : !!value)));
}

/**
 * Runs WGSL expressions in Node, as written: the kernel's rule (`fn name(…)->T{return <e>;}`) and
 * the call sites that feed it, so what runs is the WGSL text itself, never a second copy of it.
 *
 * An expression is made of names, `u`-suffixed integer literals, `!`, `&&`, `||`, comparisons,
 * the integer operators `& | << >> + - *` (u32, wrapping, as the kernel's index math), calls,
 * indexing and field access. A name is a parameter, a host binding, or a one-statement WGSL
 * function of the same source, called by its text; nothing else parses — a float literal, an
 * unknown name or function, a statement — so a kernel edit that leaves this subset fails loudly.
 * `f32` arguments are rounded to f32 first, as the kernel receives them, and `u32` wrapped.
 * The line and sprite shaders' float-vector reader is another subset, of other statements
 * (`../../visibility/shader/shaderText.fixture.ts`).
 */
type Value = boolean | number | object;
type Env = Record<string, Value>;
type Node = (env: Env) => Value;

const TOKEN = /\s*(&&|\|\||<<|>>|<=|>=|==|!=|[<>!()[\],.&|+\-*]|\d+u|[A-Za-z_][A-Za-z0-9_]*)/y;
const COMPARE: Record<string, (a: number, b: number) => boolean> = {
  '<': (a, b) => a < b,
  '>': (a, b) => a > b,
  '<=': (a, b) => a <= b,
  '>=': (a, b) => a >= b,
  '==': (a, b) => a === b,
  '!=': (a, b) => a !== b,
};
/** Loosest first, below comparison; each wraps to u32. */
const INTEGER: [string, (a: number, b: number) => number][][] = [
  [['|', (a, b) => (a | b) >>> 0]],
  [['&', (a, b) => (a & b) >>> 0]],
  [
    ['<<', (a, b) => (a << b) >>> 0],
    ['>>', (a, b) => a >>> b],
  ],
  [
    ['+', (a, b) => (a + b) >>> 0],
    ['-', (a, b) => (a - b) >>> 0],
  ],
  [['*', (a, b) => Math.imul(a, b) >>> 0]],
];

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

/** Parses `text` against the names `known` accepts; `call` resolves a WGSL function by name. */
function parse(text: string, known: (name: string) => boolean, call: (name: string) => Callable) {
  const list = tokens(text);
  let at = 0;
  const take = (token: string) => list[at] === token && (at++, true);
  const expect = (token: string) => {
    if (!take(token)) throw new Error(`WGSL_PREDICATE_PAREN: ${token} at ${list[at]}`);
  };
  const postfix = (base: Node): Node => {
    if (take('[')) {
      const index = or();
      expect(']');
      return postfix((env) => (base(env) as ArrayLike<Value>)[index(env) as number]);
    }
    if (take('.')) {
      const field = list[at++];
      return postfix((env) => (base(env) as Env)[field]);
    }
    return base;
  };
  const primary = (): Node => {
    if (take('!')) {
      const inner = primary();
      return (env) => !inner(env);
    }
    if (take('(')) {
      const inner = or();
      expect(')');
      return postfix(inner);
    }
    const token = list[at++] ?? '';
    if (/^\d+u$/.test(token)) {
      const value = Number(token.slice(0, -1));
      return () => value;
    }
    if (take('(')) {
      const args: Node[] = [];
      while (!take(')')) {
        args.push(or());
        take(',');
      }
      const fn = call(token);
      return postfix((env) => fn(env, ...args.map((arg) => arg(env))));
    }
    if (!known(token)) throw new Error(`WGSL_PREDICATE_NAME: ${token}`);
    return postfix((env) => env[token]);
  };
  const binary = (level: number): Node => {
    if (level === INTEGER.length) return primary();
    let node = binary(level + 1);
    for (;;) {
      const op = INTEGER[level].find(([token]) => list[at] === token);
      if (!op) return node;
      at++;
      const left = node,
        right = binary(level + 1);
      node = (env) => op[1](left(env) as number, right(env) as number);
    }
  };
  const compare = (): Node => {
    const left = binary(0),
      op = COMPARE[list[at]];
    if (!op) return left;
    at++;
    const right = binary(0);
    return (env) => op(left(env) as number, right(env) as number);
  };
  const chain = (token: string, next: () => Node, join: (a: Value, b: () => Value) => Value) => {
    let node = next();
    while (take(token)) {
      const left = node,
        right = next();
      node = (env) => join(left(env), () => right(env));
    }
    return node;
  };
  const and = () => chain('&&', compare, (a, b) => a && b());
  const or = (): Node => chain('||', and, (a, b) => a || b());
  const root = or();
  if (at !== list.length) throw new Error(`WGSL_PREDICATE_TRAILING: ${list[at]}`);
  return root;
}

type Callable = (env: Env, ...args: Value[]) => Value;
const CAST: Record<string, (value: Value) => Value> = {
  bool: (value) => !!value,
  f32: (value) => Math.fround(value as number),
  u32: (value) => (value as number) >>> 0,
};

/**
 * The expressions and one-statement functions of `source`, with `host` naming what the kernel reads
 * from its buffers, uniforms and locals. A host function stands for a WGSL one only where the
 * source has none of that name.
 */
export function wgslScope(source: string, host: Env = {}) {
  const functions = new Map<string, Callable>();
  const call = (name: string): Callable => {
    const known = functions.get(name);
    if (known) return known;
    const match = new RegExp(`fn ${name}\\(([^)]*)\\)->(\\w+)\\{\\s*return ([^;]+);\\s*\\}`).exec(
      source,
    );
    if (!match) {
      const bound = host[name];
      if (typeof bound !== 'function') throw new Error(`WGSL_PREDICATE_MISSING: ${name}`);
      return (_env, ...args) => (bound as (...args: Value[]) => Value)(...args);
    }
    const params = match[1]
      .split(',')
      .filter((param) => param.trim())
      .map((param) => param.trim().split(':'));
    for (const [, type] of params) if (!CAST[type]) throw new Error(`WGSL_PREDICATE_TYPE: ${type}`);
    const names = params.map(([id]) => id);
    const body = parse(match[3], (id) => names.includes(id) || id in host, call);
    const fn: Callable = (_env, ...args) => {
      const local: Env = { ...host };
      params.forEach(([id, type], i) => (local[id] = CAST[type](args[i])));
      return body(local);
    };
    functions.set(name, fn);
    return fn;
  };
  return {
    /** Function `name` of the source, called with plain values. */
    fn: (name: string) => {
      const fn = call(name);
      return (...args: Value[]) => fn(host, ...args);
    },
    /** Expression `text`, its names read from `host` then `locals`. */
    expression(text: string, locals: readonly string[] = []) {
      const node = parse(text, (id) => id in host || locals.includes(id), call);
      return (values: Env = {}) => node({ ...host, ...values });
    },
  };
}

/** A pure WGSL predicate of `source`, called with its arguments: the rule as the kernel runs it. */
export const wgslPredicate = (source: string, name: string) => wgslScope(source).fn(name);

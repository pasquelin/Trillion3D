/**
 * Runs the `lineClip` text of a shader (`lineWgsl.ts`) on the CPU: a small reader of the few
 * statements and expressions it is written in — declarations, one early return, arithmetic on
 * scalars and vectors, swizzles, `select`, `?:`, `length` and the vector constructors. The tests
 * then measure what the real text does, in WGSL and in GLSL, instead of a copy of its formula.
 */
type Value = number | number[] | boolean;

const TOKEN = /\s*(\d+\.?\d*|[A-Za-z_]\w*|&&|\|\||==|!=|<=|>=|[-+*/(),.<>?:!])/y;

function tokens(text: string) {
  const out: string[] = [];
  TOKEN.lastIndex = 0;
  while (/\S/.test(text.slice(TOKEN.lastIndex))) {
    const found = TOKEN.exec(text);
    if (!found) throw new Error(`unread shader text: ${text.slice(TOKEN.lastIndex)}`);
    out.push(found[1]);
  }
  return out;
}

const lift = (a: Value, b: Value, f: (x: number, y: number) => number): Value => {
  if (Array.isArray(a) || Array.isArray(b)) {
    const size = Array.isArray(a) ? a.length : (b as number[]).length;
    const at = (v: Value, i: number) => (Array.isArray(v) ? v[i] : (v as number));
    return Array.from({ length: size }, (_, i) => f(at(a, i), at(b, i)));
  }
  return f(a as number, b as number);
};
const AXES = 'xyzw';
const CALLS: Record<string, (...args: Value[]) => Value> = {
  select: (a, b, c) => (c ? b : a),
  length: (v) => Math.hypot(...(v as number[])),
};
const vector = (...args: Value[]) => args.flat() as number[];

/** Evaluates one expression of the shader text over the named values. */
function evaluate(text: string, scope: Record<string, Value>): Value {
  const list = tokens(text);
  let at = 0;
  const peek = () => list[at],
    take = (want?: string) => {
      const token = list[at++];
      if (want && token !== want) throw new Error(`expected ${want}, read ${token}`);
      return token;
    };
  const LEVELS = [
    ['?'],
    ['||'],
    ['&&'],
    ['==', '!=', '<', '>', '<=', '>='],
    ['+', '-'],
    ['*', '/'],
  ];
  const APPLY: Record<string, (a: Value, b: Value) => Value> = {
    '||': (a, b) => !!a || !!b,
    '&&': (a, b) => !!a && !!b,
    '==': (a, b) => a === b,
    '!=': (a, b) => a !== b,
    '<': (a, b) => (a as number) < (b as number),
    '>': (a, b) => (a as number) > (b as number),
    '<=': (a, b) => (a as number) <= (b as number),
    '>=': (a, b) => (a as number) >= (b as number),
    '+': (a, b) => lift(a, b, (x, y) => x + y),
    '-': (a, b) => lift(a, b, (x, y) => x - y),
    '*': (a, b) => lift(a, b, (x, y) => x * y),
    '/': (a, b) => lift(a, b, (x, y) => x / y),
  };
  const level = (rank: number): Value => {
    if (rank === LEVELS.length) return unary();
    let left = level(rank + 1);
    while (LEVELS[rank].includes(peek())) {
      const op = take();
      if (op === '?') {
        const yes = level(0);
        take(':');
        const no = level(0);
        left = left ? yes : no;
      } else left = APPLY[op](left, level(rank + 1));
    }
    return left;
  };
  const unary = (): Value => {
    if (peek() === '-') {
      take();
      return lift(0, unary(), (x, y) => x - y);
    }
    let value = primary();
    while (peek() === '.') {
      take();
      const picked = [...take()].map((axis) => (value as number[])[AXES.indexOf(axis)]);
      value = picked.length === 1 ? picked[0] : picked;
    }
    return value;
  };
  const primary = (): Value => {
    const token = take();
    if (token === '(') {
      const inner = level(0);
      take(')');
      return inner;
    }
    if (/^\d/.test(token)) return Number(token);
    if (peek() !== '(') {
      if (!(token in scope)) throw new Error(`unknown name ${token}`);
      return scope[token];
    }
    take('(');
    const args: Value[] = [];
    while (peek() !== ')') {
      args.push(level(0));
      if (peek() === ',') take();
    }
    take(')');
    return (CALLS[token] ?? vector)(...args);
  };
  const value = level(0);
  if (at !== list.length) throw new Error(`unread tokens in ${text}`);
  return value;
}

/** Splits at the commas outside parentheses. */
function topLevel(text: string) {
  const parts: string[] = [];
  let depth = 0,
    start = 0;
  [...text].forEach((c, i) => {
    depth += c === '(' ? 1 : c === ')' ? -1 : 0;
    if (c !== ',' || depth !== 0) return;
    parts.push(text.slice(start, i));
    start = i + 1;
  });
  return [...parts, text.slice(start)];
}

/** The `lineClip` of `source` as a function: clip position, clip direction, width, viewport. */
export function runLineClip(source: string) {
  const open = source.indexOf('{');
  const params = topLevel(source.slice(source.indexOf('(') + 1, source.indexOf(')')));
  const names = params.map((p) => p.trim().split(/[\s:]+/)[p.includes(':') ? 0 : 1]);
  const body = source.slice(open + 1, source.lastIndexOf('}'));
  const statements = body
    .split(/;|\n/)
    .map((s) => s.trim())
    .filter((s) => s && s !== '}');
  return (...args: Value[]): number[] => {
    const scope: Record<string, Value> = {};
    names.forEach((name, i) => (scope[name] = args[i]));
    for (const statement of statements) {
      const guarded = statement.match(/^if\((.*)\)\{?return (.*?)\}?$/);
      if (guarded) {
        if (evaluate(guarded[1], scope)) return evaluate(guarded[2], scope) as number[];
        continue;
      }
      if (statement.startsWith('return ')) return evaluate(statement.slice(7), scope) as number[];
      const declared = statement.replace(/^(let|var|float|vec[234])\s+/, '');
      for (const part of topLevel(declared)) {
        const [name, ...expression] = part.split('=');
        scope[name.trim()] = evaluate(expression.join('='), scope);
      }
    }
    throw new Error('lineClip returned nothing');
  };
}

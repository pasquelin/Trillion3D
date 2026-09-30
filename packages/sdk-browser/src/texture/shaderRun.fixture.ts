// Runs whole WGSL functions — vectors, swizzles, matrices, loops — in JavaScript, where
// `shaderFunctions` (`shaderRule.fixture.ts`) takes scalar ones. The shipped text is parsed, not
// matched: an edit of the shader is what the test runs.
import { functionsOf } from './shaderRule.fixture.ts';
import { builtins } from './shaderRunBuiltins.fixture.ts';

export { Mat, type Vec } from './shaderRunBuiltins.fixture.ts';
const SWIZZLE = /^(?:[xyzw]{1,4}|[rgba]{1,4})$/;
/** A token, or what it skips: blanks and `//` comments. */
const TOKEN =
  /\s+|\/\/[^\n]*|((?:0x[\da-f]+|\d+\.?\d*(?:e[+-]?\d+)?|\.\d+(?:e[+-]?\d+)?)[uif]?|[A-Za-z_]\w*|&&|\|\||<=|>=|==|!=|>>|<<|\+\+|--|[-+*/%]=|->|[-+*/%<>=!&|^~(){}[\];,.:@])/giy;
const JS_RESERVED = new Set(['in', 'new', 'this', 'class', 'delete', 'typeof', 'void', 'with']);
/** Each binary operator's precedence, the loosest first. */
const BINARY: Record<string, number> = Object.fromEntries(
  ['||', '&&', '|', '^', '&', '== !=', '< > <= >=', '<< >>', '+ -', '* / %'].flatMap((ops, i) =>
    ops.split(' ').map((op) => [op, i + 1]),
  ),
);

/** WGSL's zero of a type declared with no value (`var c:array<vec3f,3>;`): `[]`, `[0,0]`, `0`. */
function zeroOf(type: string[]) {
  if (type[0] === 'array') return '[]';
  const size = /^vec([234])/.exec(type[0] ?? '')?.[1];
  return size ? `[${Array(Number(size)).fill(0)}]` : '0';
}

function tokens(text: string) {
  const out: string[] = [];
  TOKEN.lastIndex = 0;
  for (let match; TOKEN.lastIndex < text.length;) {
    if (!(match = TOKEN.exec(text)))
      throw new Error(`WGSL token at ${text.slice(TOKEN.lastIndex)}`);
    if (match[1]) out.push(JS_RESERVED.has(match[1]) ? `$${match[1]}` : match[1]);
  }
  return out;
}

/** WGSL tokens to JavaScript text: every operator a call of `$b`, every swizzle one of `$sw`. */
class Translator {
  at = 0;
  private readonly t: string[];
  constructor(t: string[]) {
    this.t = t;
  }
  peek = () => this.t[this.at];
  next = () => this.t[this.at++];
  eat(token: string) {
    if (this.next() !== token) throw new Error(`WGSL: ${token} expected at token ${this.at - 1}`);
  }
  /** Skips an attribute, `@name` or `@name(…)`. */
  attribute() {
    this.next();
    this.next();
    if (this.peek() === '(') while (this.next() !== ')');
  }
  functionText() {
    while (this.peek() === '@') this.attribute();
    this.eat('fn');
    const name = this.next(),
      params: string[] = [];
    this.eat('(');
    while (this.peek() !== ')') {
      while (this.peek() === '@') this.attribute();
      params.push(this.next());
      while (this.peek() !== ',' && this.peek() !== ')') this.next();
      if (this.peek() === ',') this.next();
    }
    while (this.peek() !== '{') this.next();
    return `function ${name}(${params}){${this.block().slice(1)}`;
  }
  block(): string {
    this.eat('{');
    let body = '';
    while (this.peek() !== '}') body += this.statement();
    this.next();
    return `{${body}}`;
  }
  statement(): string {
    const token = this.peek();
    if (token === '{') return this.block();
    if (token === 'return') {
      this.next();
      const value = this.peek() === ';' ? '' : this.expression();
      this.eat(';');
      return `return ${value};`;
    }
    if (token === 'if') {
      this.next();
      let text = `if(${this.expression()})${this.block()}`;
      if (this.peek() === 'else') {
        this.next();
        text += `else ${this.peek() === 'if' ? this.statement() : this.block()}`;
      }
      return text;
    }
    if (token === 'while') return (this.next(), `while(${this.expression()})${this.block()}`);
    if (token === 'for') {
      this.next();
      this.eat('(');
      const init = this.simple(';'),
        test = this.expression();
      this.eat(';');
      return `for(${init};${test};${this.simple(')')})${this.block()}`;
    }
    return `${this.simple(';')};`;
  }
  /** A declaration, an assignment, an increment or a call, up to `end`, which it consumes. */
  simple(end: string) {
    let text: string;
    if (['let', 'var', 'const'].includes(this.peek())) {
      this.next();
      const name = this.next(),
        type: string[] = [];
      while (this.peek() !== '=' && this.peek() !== end) type.push(this.next());
      if (this.peek() === end) text = `let ${name}=${zeroOf(type.slice(1))}`;
      else text = (this.next(), `let ${name}=${this.expression()}`);
    } else {
      const target = this.expression(),
        op = this.peek();
      if (op === '=') text = (this.next(), `${target}=${this.expression()}`);
      else if (op.length === 2 && op[1] === '=' && op[0] in BINARY)
        text = (this.next(), `${target}=$b("${op[0]}",${target},${this.expression()})`);
      else if (op === '++' || op === '--')
        text = (this.next(), `${target}=$b("${op[0]}",${target},1)`);
      else text = target;
    }
    this.eat(end);
    return text;
  }
  expression(min = 1): string {
    let left = this.unary();
    for (let op = this.peek(); BINARY[op] >= min; op = this.peek()) {
      this.next();
      const right = this.expression(BINARY[op] + 1);
      left = op === '&&' || op === '||' ? `(${left}${op}${right})` : `$b("${op}",${left},${right})`;
    }
    return left;
  }
  unary(): string {
    const token = this.peek();
    if (token === '-') return (this.next(), `$b("-",0,${this.unary()})`);
    if (token === '!') return (this.next(), `(!${this.unary()})`);
    // `~` flips a `u32`'s bits; `&` hands an atomic its pointer, through `$ref`.
    if (token === '~') return (this.next(), `$b("^",${this.unary()},0xffffffff)`);
    if (token === '&') {
      const target = (this.next(), this.postfix(this.primary()));
      return `$ref(()=>${target},(v)=>{${target}=v;})`;
    }
    return this.postfix(this.primary());
  }
  primary() {
    const token = this.next();
    if (token === '(') {
      const inner = this.expression();
      this.eat(')');
      return `(${inner})`;
    }
    if (/^0x/i.test(token)) return String(Number(token.replace(/u$/i, '')));
    if (/^[\d.]/.test(token)) return String(Number(token.replace(/[uif]$/i, '')));
    if (this.peek() !== '(') return token;
    this.next();
    const args: string[] = [];
    while (this.peek() !== ')') {
      args.push(this.expression());
      if (this.peek() === ',') this.next();
    }
    this.next();
    return `${token}(${args})`;
  }
  postfix(value: string): string {
    for (;;) {
      if (this.peek() === '.') {
        this.next();
        const member = this.next();
        value = SWIZZLE.test(member) ? `$sw(${value},"${member}")` : `${value}.${member}`;
      } else if (this.peek() === '[') {
        this.next();
        // An index is an integer: a WGSL integer division, run in doubles, is truncated there.
        value = `${value}[Math.trunc(${this.expression()})]`;
        this.eat(']');
      } else return value;
    }
  }
}

/**
 * The functions `names` of a shipped WGSL text, run in JavaScript: vectors as arrays, matrices as
 * `Mat`, arithmetic component-wise with scalars broadcast, every WGSL built-in the functions call
 * (`bitcast<T>` as `bitcast_T`) by `shaderRunBuiltins.fixture.ts`, the module's bindings by `scope`.
 */
export function shaderRun<T>(source: string, names: string[], scope: object): T {
  const text = functionsOf(source, names).replace(/bitcast<(\w+)>/g, 'bitcast_$1');
  const js = [...text.matchAll(/(?:@\w+(?:\([^)]*\))?\s*)*fn \w+\(/g)]
    .map((header, i, all) =>
      new Translator(tokens(text.slice(header.index, all[i + 1]?.index))).functionText(),
    )
    .join('\n');
  const all: Record<string, unknown> = { ...builtins, ...scope };
  return new Function(...Object.keys(all), `${js};return {${names}};`)(...Object.values(all));
}

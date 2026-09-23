// The Rust half of `check-helpers.ts`: the free functions a module defines, read by a scanner
// that follows braces rather than lines, so a signature may span several lines, and that knows
// which blocks are `impl`, `trait`, function bodies or `#[cfg(test)]` items.
import { posix } from 'node:path';
import type { Helper } from './check-helpers.ts';

/** `text` with comments, strings and character literals blanked, every offset kept. */
function blanked(text: string): string {
  const blank = (match: string) => match.replace(/[^\n]/g, ' ');
  return text.replace(
    /\/\/[^\n]*|\/\*[\s\S]*?\*\/|r(#*)"[\s\S]*?"\1|"(?:\\[\s\S]|[^"\\])*"|'(?:\\.|[^'\\\n])'/g,
    blank,
  );
}

/** The offset of the bracket closing the one opened at `open`, in blanked text. */
function closing(code: string, open: number): number {
  let depth = 0;
  for (let at = open; at < code.length; at++) {
    if ('{(['.includes(code[at])) depth++;
    else if ('})]'.includes(code[at]) && --depth === 0) return at;
  }
  return code.length - 1;
}

/** The `{` opening a body after `from`, or -1 when a `;` outside brackets ends a declaration. */
function bodyStart(code: string, from: number): number {
  let depth = 0;
  for (let at = from; at < code.length; at++) {
    const ch = code[at];
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (depth === 0 && (ch === '{' || ch === ';')) return ch === '{' ? at : -1;
  }
  return -1;
}

/** Parameter types only: names and patterns do not make two helpers different. */
function typesOf(params: string): string {
  let depth = 0,
    part = '';
  const parts: string[] = [];
  for (const ch of params) {
    if ('<([{'.includes(ch)) depth++;
    if ('>)]}'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) {
      parts.push(part);
      part = '';
    } else part += ch;
  }
  if (part.trim()) parts.push(part);
  return parts
    .map((p) => (p.includes(':') ? p.slice(p.indexOf(':') + 1) : '?').replace(/\s+/g, ''))
    .join(',');
}

type Frame = 'item' | 'skip';

/** The free functions of a Rust module: not methods, not nested, not `#[cfg(test)]`. */
export function rsHelpers(file: string, text: string): Helper[] {
  const code = blanked(text);
  const out: Helper[] = [];
  const frames: Frame[] = [];
  let pending: Frame | null = null;
  let cfgTest = false;
  const token = /#\[cfg\(test\)\]|\b(?:impl|trait)\b|\bfn\s+(\w+)|[{};()[\]]/g;
  let brackets = 0;
  for (let m = token.exec(code); m; m = token.exec(code)) {
    const [word, name] = m;
    if (word === '(' || word === '[') brackets++;
    else if (word === ')' || word === ']') brackets--;
    else if (word === '#[cfg(test)]') cfgTest = true;
    else if (word === 'impl' || word === 'trait') pending ??= 'skip';
    else if (name !== undefined) {
      const free = !cfgTest && !pending && !frames.includes('skip');
      pending = 'skip';
      cfgTest = false;
      if (!free) continue;
      const params = code.indexOf('(', m.index);
      const paramsEnd = closing(code, params);
      const open = bodyStart(code, paramsEnd + 1);
      if (open === -1) continue;
      const returns = code.slice(paramsEnd + 1, open).replace(/^\s*->/, '');
      const body = text
        .slice(open, closing(code, open) + 1)
        .replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '')
        .replace(/\s+/g, '');
      const signature = `(${typesOf(code.slice(params + 1, paramsEnd))})->${returns.replace(/\bwhere\b[\s\S]*$/, '').replace(/\s+/g, '')}`;
      out.push({ name, signature, body, file });
    } else if (word === '{') {
      frames.push(pending ?? (cfgTest ? 'skip' : 'item'));
      pending = null;
      cfgTest = false;
    } else if (word === '}') frames.pop();
    else if (word === ';' && brackets === 0) {
      pending = null;
      cfgTest = false;
    }
  }
  return out;
}

/** The module paths a crate declares `#[cfg(test)] mod name;`: files and folders of test code. */
export function cfgTestModules(files: Map<string, string>): string[] {
  const out: string[] = [];
  for (const [file, text] of files) {
    if (!file.endsWith('.rs')) continue;
    const stem = posix.basename(file, '.rs');
    const dir = ['lib', 'main', 'mod'].includes(stem)
      ? posix.dirname(file)
      : posix.join(posix.dirname(file), stem);
    for (const m of blanked(text).matchAll(
      /#\[cfg\(test\)\]\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*;/g,
    ))
      out.push(`${dir}/${m[1]}.rs`, `${dir}/${m[1]}/`);
  }
  return out;
}

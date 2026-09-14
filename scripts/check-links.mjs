#!/usr/bin/env node
// Zero-dependency Markdown link checker. Walks every *.md file in the repo
// (hidden files included), checks relative links/images/hrefs resolve to a
// real file, and that a fragment into another Markdown file names a real
// heading anchor or an explicit id/name. Runtime routes (/api/...) are
// reported separately, never checked. Same behavior as the retired
// scripts/check-links.py, ported so `npm run check:links` needs no Python.
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {dirname, extname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const sdkRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const excludedDirs = new Set(['.git', '.idea', 'node_modules', 'dist', 'target', '.claude']);

function findMarkdownFiles(root) {
 const results = [];
 const walk = dir => {
  let entries;
  try { entries = readdirSync(dir, {withFileTypes: true}); }
  catch { return; }
  for (const entry of entries) {
   if (excludedDirs.has(entry.name)) continue;
   const full = join(dir, entry.name);
   if (entry.isDirectory()) walk(full);
   else if (entry.isFile() && entry.name.endsWith('.md')) results.push(full);
  }
 };
 walk(root);
 return results;
}

// Strip fenced code blocks (``` or ~~~, 3+ marks) so links inside samples never count.
function prose(text) {
 return text.replace(/^\s*(`{3,}|~{3,}).*?^\s*\1\s*$/gms, '');
}

function slug(heading) {
 let s = heading.replace(/<[^>]*>/g, '');
 s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
 const lowered = s.toLowerCase();
 let out = '';
 for (const c of lowered) if (c === '-' || c === '_' || c === ' ' || /\p{L}|\p{N}/u.test(c)) out += c;
 return out.replace(/ /g, '-');
}

function anchors(path) {
 const s = prose(readFileSync(path, 'utf8'));
 const result = new Set();
 for (const m of s.matchAll(/(?:id|name)=["']([^"']+)/g)) result.add(m[1]);
 const counts = {};
 for (const m of s.matchAll(/^#{1,6}\s+(.+?)\s*#*$/gm)) {
  const key = slug(m[1]);
  const n = counts[key] ?? 0; counts[key] = n + 1;
  result.add(n ? `${key}-${n}` : key);
 }
 return result;
}

function decode(part) {
 try { return decodeURIComponent(part); } catch { return part; }
}

// Minimal stand-in for urllib.parse.urlsplit on the plain relative/absolute
// paths this checker deals with (scheme and protocol-relative links are
// filtered out by the caller before this runs).
function splitTarget(t) {
 let path = t, fragment = '';
 const hash = path.indexOf('#');
 if (hash !== -1) { fragment = path.slice(hash + 1); path = path.slice(0, hash); }
 const query = path.indexOf('?');
 if (query !== -1) path = path.slice(0, query);
 return {path, fragment};
}

const hasScheme = t => /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(t);
const exists = path => { try { statSync(path); return true; } catch { return false; } };

const bad = [];
let count = 0;
const runtimeRoutes = [];

for (const file of findMarkdownFiles(sdkRoot)) {
 const s = prose(readFileSync(file, 'utf8'));
 const targets = [
  ...[...s.matchAll(/\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+["'][^\n]*?["'])?\s*\)/g)].map(m => m[1]),
  ...[...s.matchAll(/^\s*\[[^\]]+\]:\s*(\S+)/gm)].map(m => m[1]),
  ...[...s.matchAll(/(?:href|src)=["']([^"']+)/g)].map(m => m[1]),
 ];
 for (let t of targets) {
  t = t.replace(/^[<>]+/, '').replace(/[<>]+$/, '');
  if (hasScheme(t) || t.startsWith('//')) continue;
  if (t.startsWith('/api/')) { runtimeRoutes.push([file, t]); continue; }
  count++;
  const {path, fragment} = splitTarget(t);
  const dest = path ? resolve(dirname(file), decode(path)) : file;
  if (!exists(dest)) { bad.push([file, t, 'missing file']); continue; }
  if (fragment && extname(dest).toLowerCase() === '.md' && !anchors(dest).has(decode(fragment))) {
   bad.push([file, t, 'missing anchor']);
  }
 }
}

console.log(JSON.stringify({localFileLinks: count, errors: bad, runtimeRoutesNotChecked: runtimeRoutes}, null, 2));
process.exitCode = bad.length ? 1 : 0;

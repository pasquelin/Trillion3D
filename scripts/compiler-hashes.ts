/**
 * The fingerprint of the reference scenes' caches (#1352): every file a compiler writes for them,
 * with its SHA-256. A cache is named by its key, which hashes the compiler's own sources, so the
 * key is replaced by `<key>` in paths and contents: two compilers that write the same bytes under
 * their own key give the same fingerprint — the five platforms of one commit, and a branch against
 * `develop`.
 *
 *   node scripts/compiler-hashes.ts <compiler> <record.json> [<name>]
 *   node scripts/compiler-hashes.ts --compare <reference.json> <record.json>...
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { compileFullCache } from './native-compiler.ts';
import { COOKED_SCENES } from './site-caches.ts';

/** The scenes the distributed compiler is proved and trained on, both committed and read by the
 *  tests alone: a terrain of one large mesh, and a garden of parametric rings under a light. */
export const REFERENCE_SCENES = ['mountain-terrain', 'kinetic-garden'] as const;

/** A compiler's fingerprint of the reference scenes; `bytes`, its size, when it is distributed. */
export interface HashRecord {
  compiler: string;
  bytes?: number;
  files: Record<string, string>;
}

const ROOT = resolve(import.meta.dirname, '..');
const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

/** Each file of the compiled cache `cache`, under `prefix`, with its SHA-256; the cache's key,
 *  read from its manifest, replaced by `<key>` in both. The lock of a finished cook is skipped. */
export function cacheFingerprint(cache: string, prefix: string): Record<string, string> {
  const manifest = JSON.parse(readFileSync(join(cache, 'native/full/manifest.json'), 'utf8')) as {
    key: string;
  };
  const files: Record<string, string> = {};
  for (const file of readdirSync(cache, { recursive: true }).map(String).sort()) {
    const path = join(cache, file);
    if (file.endsWith('.lock') || !statSync(path).isFile()) continue;
    const bytes = readFileSync(path).toString('latin1').replaceAll(manifest.key, '<key>');
    const name = file.replaceAll('\\', '/').replaceAll(manifest.key, '<key>');
    files[`${prefix}/${name}`] = sha256(Buffer.from(bytes, 'latin1'));
  }
  return files;
}

/** Compiles every reference scene with `executable` into a fresh folder and fingerprints it. */
export function referenceHashes(executable: string): Record<string, string> {
  let files: Record<string, string> = {};
  for (const name of REFERENCE_SCENES) {
    const { directory, ...compile } = COOKED_SCENES[name];
    const cache = mkdtempSync(join(tmpdir(), `trillion3d-${name}-`));
    try {
      compileFullCache({
        cwd: resolve(ROOT, directory),
        ...compile,
        cache,
        executable,
        stdio: ['ignore', 'ignore', 'inherit'],
      });
      files = { ...files, ...cacheFingerprint(cache, name) };
    } finally {
      rmSync(cache, { recursive: true, force: true });
    }
  }
  return files;
}

/** The files whose hash differs between two fingerprints, one missing on either side included. */
export function differences(reference: HashRecord, other: HashRecord): string[] {
  const names = new Set([...Object.keys(reference.files), ...Object.keys(other.files)]);
  return [...names].filter((name) => reference.files[name] !== other.files[name]).sort();
}

/** One line per record: its digest over every file, its size, and what differs from the first. */
function compare(paths: string[]): boolean {
  const records = paths.map((path) => JSON.parse(readFileSync(path, 'utf8')) as HashRecord);
  let equal = true;
  for (const record of records) {
    const differing = differences(records[0], record);
    const size = record.bytes === undefined ? '' : `, ${(record.bytes / 2 ** 20).toFixed(1)} MiB`;
    const digest = sha256(JSON.stringify(record.files));
    console.log(`${record.compiler}: ${Object.keys(record.files).length} files, ${digest}${size}`);
    for (const file of differing) console.log(`  differs from ${records[0].compiler}: ${file}`);
    equal &&= differing.length === 0;
  }
  return equal;
}

if (import.meta.filename === process.argv[1]) {
  const [first, ...rest] = process.argv.slice(2);
  if (first === '--compare') {
    if (!compare(rest)) process.exit(1);
  } else {
    const record: HashRecord = { compiler: rest[1] ?? first, files: referenceHashes(first) };
    writeFileSync(rest[0], `${JSON.stringify(record, null, 2)}\n`);
  }
}

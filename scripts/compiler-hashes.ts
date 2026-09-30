/**
 * The fingerprint of the reference scenes' caches (#1352): every file a compiler writes for them,
 * by the SHA-256 of its bytes, so that two compilers that cook the same bytes have the same one —
 * the five platforms of one commit, and a branch against `develop`. What a cook writes beside its
 * bytes is not compared: the run's report (a key ending in `Ms`, `peakRssBytes`, `reusedPages`,
 * as `compiler_manifest_pages` names it) and the folder it was written to. A name made of a
 * SHA-256 — the cache key, which hashes the compiler's own sources, and each content-addressed
 * file — reads `<sha>`: such files are still compared by content, the hashes of the files one
 * pattern names listed together.
 *
 *   node scripts/compiler-hashes.ts <compiler> <record.json> [<name>]
 *   node scripts/compiler-hashes.ts --compare <reference.json> <record.json>...
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { sha256 } from '../packages/sdk-node/src/compiler/provenance.mts';
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

const SHA = /[0-9a-f]{64}/g;
/** What a run reports rather than builds: its times, its memory peak, the pages it found built. */
const MEASURE = /Ms$|^peakRssBytes$|^reusedPages$/;

/** A JSON file of `cache` without its run's measures, its folder read `<cache>`; other bytes as is. */
function comparable(bytes: Buffer, file: string, cache: string): Buffer | string {
  if (!file.endsWith('.json')) return bytes;
  const document: unknown = JSON.parse(bytes.toString('utf8'), (key, value: unknown) => {
    if (MEASURE.test(key)) return undefined;
    if (typeof value !== 'string' || !value.includes(cache)) return value;
    return value.replaceAll(cache, '<cache>').replaceAll('\\', '/');
  });
  return JSON.stringify(document);
}

/** Each file of the compiled cache `cache`, under `prefix`, by the SHA-256 of what is compared;
 *  names and contents with `<sha>` for a SHA-256. The lock of a finished cook is skipped. */
export function cacheFingerprint(cache: string, prefix: string): Record<string, string> {
  const hashes = new Map<string, string[]>();
  for (const file of readdirSync(cache, { recursive: true }).map(String)) {
    const path = join(cache, file);
    if (file.endsWith('.lock') || !statSync(path).isFile()) continue;
    const content = comparable(readFileSync(path), file, cache);
    const text = typeof content === 'string' ? content.replaceAll(SHA, '<sha>') : content;
    const name = `${prefix}/${file.replaceAll('\\', '/').replaceAll(SHA, '<sha>')}`;
    hashes.set(name, [...(hashes.get(name) ?? []), sha256(text)]);
  }
  return Object.fromEntries(
    [...hashes]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, list]) => [name, list.sort().join(' ')]),
  );
}

/** Compiles every reference scene with `executable` into a fresh folder, handed to `visit` before
 *  it is removed; with no `visit`, a training run of profile-guided optimisation. */
export function compileReferenceScenes(
  executable: string,
  visit: (cache: string, name: string) => void = () => {},
): void {
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
      visit(cache, name);
    } finally {
      rmSync(cache, { recursive: true, force: true });
    }
  }
}

/** Every reference scene compiled with `executable`, fingerprinted. */
export function referenceHashes(executable: string): Record<string, string> {
  const files: Record<string, string> = {};
  compileReferenceScenes(executable, (cache, name) =>
    Object.assign(files, cacheFingerprint(cache, name)),
  );
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
    const files = Object.values(record.files).join(' ').split(' ').length;
    console.log(`${record.compiler}: ${files} files, ${digest}${size}`);
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
    const record: HashRecord = {
      compiler: rest[1] ?? first,
      files: referenceHashes(resolve(first)),
    };
    writeFileSync(rest[0], `${JSON.stringify(record, null, 2)}\n`);
  }
}

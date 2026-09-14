import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const sha256 = (bytes: string) => createHash('sha256').update(bytes).digest('hex');
/** Public provenance boundary: consumers never read SDK implementation paths themselves. Hashes only — full source is not loaded into the snapshot. */
export async function getSdkProvenance() {
  const root = new URL('../../', import.meta.url);
  const files: Record<string, { sha256: string }> = {};
  async function visit(relative: string) {
    for (const entry of (await readdir(new URL(relative, root), { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      const name = relative + entry.name;
      if (entry.isDirectory()) await visit(name + '/');
      else if (/\.(js|mjs)$/.test(entry.name)) {
        const text = await readFile(new URL(name, root), 'utf8');
        files[name] = { sha256: sha256(text) };
      }
    }
  }
  await visit('dist/');
  for (const name of [
    'packages/asset-compiler-rust/src/lib.rs',
    'packages/asset-compiler-rust/src/main.rs',
    'packages/asset-compiler-rust/src/import.rs',
    'packages/asset-compiler-rust/src/topology.rs',
    'packages/asset-compiler-rust/src/qem.rs',
    'packages/asset-compiler-rust/src/dag.rs',
    'packages/asset-compiler-rust/src/geometry_page.rs',
    'packages/asset-compiler-rust/src/manifest_binary.rs',
    'packages/asset-compiler-rust/src/accessor_validation.rs',
    'packages/asset-compiler-rust/src/perf.rs',
    'packages/asset-compiler-rust/Cargo.lock',
  ]) {
    const text = await readFile(new URL(name, root), 'utf8');
    files[name] = { sha256: sha256(text) };
  }
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8')) as {
    version: string;
  };
  return {
    sdkVersion: pkg.version,
    scope: 'Installed SDK files at archive time; loaded binary equality not established',
    files,
  };
}

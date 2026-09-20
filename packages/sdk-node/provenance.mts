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
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8')) as {
    version: string;
  };
  return {
    sdkVersion: pkg.version,
    scope: 'Installed JavaScript files; external compiler binary equality not established',
    files,
  };
}

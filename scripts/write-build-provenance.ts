import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');

export async function fingerprintBuild(
  directory: string,
): Promise<{ hash: string; modules: Record<string, string> }> {
  const files: string[] = [];
  async function visit(folder: string): Promise<void> {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const path = resolve(folder, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (
        /\.(m?js)$/.test(entry.name) &&
        basename(path) !== 'buildProvenance.js' &&
        !entry.name.includes('.test.')
      )
        files.push(path);
    }
  }
  await visit(directory);
  const modules: Record<string, string> = {};
  for (const file of files.sort())
    modules[relative(directory, file).replaceAll('\\', '/')] = sha256(await readFile(file));
  return { hash: sha256(JSON.stringify(modules)), modules };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = resolve('dist');
  const provenance = {
    version: 1,
    ...(await fingerprintBuild(directory)),
    generatedAt: new Date().toISOString(),
  };
  await writeFile(
    resolve(directory, 'sdk-browser/src/measurement/buildProvenance.js'),
    `export const SDK_BUILD_PROVENANCE=${JSON.stringify(provenance)};\n`,
  );
}

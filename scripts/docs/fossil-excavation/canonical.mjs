import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, isAbsolute } from 'node:path';

// Published example artifacts omit run timings; raw compiler output retains them.
export async function canonicalizeFossilCache(cache) {
  const full = join(cache, 'native/full');
  const pointer = JSON.parse(await readFile(join(full, 'manifest.json'), 'utf8'));
  const path = join(full, pointer.url);
  const scene = JSON.parse(await readFile(path, 'utf8'));
  for (const key of ['compileMs', 'importMs', 'clusterHierarchyPagesMs'])
    if (key in scene.metrics) scene.metrics[key] = null;
  for (const key of Object.keys(scene.metrics.phaseElapsedMs ?? {}))
    scene.metrics.phaseElapsedMs[key] = null;
  const portable = (value) =>
    isAbsolute(value) ? relative(dirname(path), value).split('\\').join('/') : value;
  if (scene.cutouts?.sheet) scene.cutouts.sheet = portable(scene.cutouts.sheet);
  if (scene.cutouts?.changes?.decisions?.file)
    scene.cutouts.changes.decisions.file = portable(scene.cutouts.changes.decisions.file);
  await writeFile(path, JSON.stringify(scene));
  const imports = join(cache, 'native/imports');
  for (const entry of await readdir(imports)) {
    const manifestPath = join(imports, entry, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.source.importMs = null;
    for (const file of manifest.source.files) {
      file.ms = null;
      file.parseMs = null;
    }
    await writeFile(manifestPath, JSON.stringify(manifest));
  }
}

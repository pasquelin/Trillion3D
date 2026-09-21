import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, isAbsolute } from 'node:path';

interface FossilMetrics {
  compileMs: number | null;
  importMs: number | null;
  clusterHierarchyPagesMs: number | null;
  phaseElapsedMs?: Record<string, number | null>;
}

interface FossilCutouts {
  sheet?: string;
  changes?: { decisions?: { file?: string } };
}

interface FossilManifestPointer {
  url: string;
}

interface FossilSceneManifest {
  metrics: FossilMetrics;
  cutouts?: FossilCutouts;
}

interface ImportManifestFile {
  ms: number | null;
  parseMs: number | null;
}

interface ImportManifest {
  source: {
    importMs: number | null;
    files: ImportManifestFile[];
  };
}

// Published example artifacts omit run timings; raw compiler output retains them.
export async function canonicalizeFossilCache(cache: string) {
  const full = join(cache, 'native/full');
  const pointer = JSON.parse(
    await readFile(join(full, 'manifest.json'), 'utf8'),
  ) as FossilManifestPointer;
  const path = join(full, pointer.url);
  const scene = JSON.parse(await readFile(path, 'utf8')) as FossilSceneManifest;
  for (const key of ['compileMs', 'importMs', 'clusterHierarchyPagesMs'] as const)
    if (key in scene.metrics) scene.metrics[key] = null;
  const phaseElapsedMs = scene.metrics.phaseElapsedMs;
  if (phaseElapsedMs) for (const key of Object.keys(phaseElapsedMs)) phaseElapsedMs[key] = null;
  const portable = (value: string) =>
    isAbsolute(value) ? relative(dirname(path), value).split('\\').join('/') : value;
  if (scene.cutouts?.sheet) scene.cutouts.sheet = portable(scene.cutouts.sheet);
  if (scene.cutouts?.changes?.decisions?.file)
    scene.cutouts.changes.decisions.file = portable(scene.cutouts.changes.decisions.file);
  await writeFile(path, JSON.stringify(scene));
  const imports = join(cache, 'native/imports');
  for (const entry of await readdir(imports)) {
    const manifestPath = join(imports, entry, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as ImportManifest;
    manifest.source.importMs = null;
    for (const file of manifest.source.files) {
      file.ms = null;
      file.parseMs = null;
    }
    await writeFile(manifestPath, JSON.stringify(manifest));
  }
}

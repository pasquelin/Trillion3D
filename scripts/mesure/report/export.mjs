import { createHash } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  readdirSync,
  mkdirSync,
  writeFileSync,
  copyFileSync,
  realpathSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { sceneNote } from '../scene.mjs';
import { assertReport, REPORT_VERSION } from '../../../site/reports/contract.ts';

/** Strip workstation paths from public evidence while retaining measurement fields. */
function publicData(value) {
  if (Array.isArray(value)) return value.map(publicData);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !['commande', 'dist', 'cache', 'ressources', 'png'].includes(key))
        .map(([key, item]) => [key, publicData(item)]),
    );
  if (typeof value === 'string' && value.startsWith('/')) return basename(value);
  return value;
}
function files(root, depth = 0) {
  if (depth > 2) return [];
  if (
    existsSync(join(root, 'mesure.json')) ||
    (existsSync(join(root, 'campagne.log')) && depth > 0)
  )
    return [join(root, 'mesure.json')];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !['vignettes', 'report-data'].includes(entry.name))
    .flatMap((entry) => files(join(root, entry.name), depth + 1));
}
function image(source, png, output, id) {
  if (!png) return null;
  const file = resolve(source, png);
  if (!file.startsWith(resolve(source) + sep) || !existsSync(file)) return null;
  if (!realpathSync(file).startsWith(realpathSync(source) + sep))
    throw new Error('Capture escapes source');
  // Copy original pixels: the report's image evidence must not introduce JPEG artifacts.
  const target = `images/${id}.png`;
  mkdirSync(join(output, 'images'), { recursive: true });
  copyFileSync(file, join(output, target));
  return target;
}
export function exportReport(source, output, id) {
  const report = { formatVersion: REPORT_VERSION, id, runs: [], records: [] };
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error('Invalid campaign ID');
  if (existsSync(output)) throw new Error('Export directory already exists');
  mkdirSync(join(output, 'sources'), { recursive: true });
  for (const file of files(source).sort()) {
    const runId = createHash('sha256').update(relative(source, file)).digest('hex').slice(0, 16);
    if (!existsSync(file)) {
      report.runs.push({
        id: runId,
        name: basename(dirname(file)),
        scene: null,
        source: null,
        status: 'missing',
        startedAt: null,
        finishedAt: null,
        commit: null,
      });
      continue;
    }
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    if (!Array.isArray(raw.series)) throw new Error(`Invalid measurement: ${file}`);
    const sourcePath = `sources/${runId}.json`;
    writeFileSync(join(output, sourcePath), JSON.stringify(publicData(raw)) + '\n');
    const errors = raw.errors?.length > 0 || !raw.finishedAt;
    report.runs.push({
      id: runId,
      name: basename(dirname(file)),
      scene: raw.scene,
      source: sourcePath,
      status: errors || !raw.finishedAt ? 'failed' : 'complete',
      startedAt: raw.startedAt ?? null,
      finishedAt: raw.finishedAt ?? null,
      commit: raw.head ?? null,
    });
    for (const [index, series] of raw.series.entries()) {
      for (const [side, data] of Object.entries(series.sides ?? {})) {
        if (!/^[a-z0-9-]+$/.test(side)) throw new Error('Invalid measurement side');
        if (side.endsWith('-aa')) continue;
        const recordId = `${id}-${runId}-${index}-${side}`;
        const identity = raw.sides?.[side] ?? {};
        report.records.push({
          id: recordId,
          runId,
          scene: raw.scene,
          sceneNote: sceneNote(raw.scene),
          view: series.view,
          quality: series.pixelError,
          engine: data.moteur ?? identity.moteur ?? raw.engine,
          commit: raw.head ?? null,
          pathVersion: raw.pathVersion ?? null,
          assetKey: identity.assetKey ?? null,
          buildHash: identity.buildHash ?? null,
          variant: data.variante ?? identity.variante ?? null,
          provenance: raw.provenance ?? null,
          pose: series.pose ?? null,
          canvas: data.canvas ?? null,
          settings: publicData(raw.settings ?? {}),
          errors: errors || Boolean(data.incidentsGpu?.length),
          gpuMethod: data.profilParEtape?.gpuMethod ?? null,
          witness: series.sides?.[`${side}-aa`] ? (series.temoinAA ?? null) : null,
          difference: series.ecartAvantApres ?? null,
          differencePair:
            series.sides?.avant && series.sides?.apres ? `${id}-${runId}-${index}` : null,
          identicalCut: series.coupeIdentique ?? null,
          data: publicData(data),
          image: image(dirname(file), data.png, output, recordId),
        });
      }
    }
  }
  assertReport(report);
  if (!report.records.length) throw new Error('No campaign measurements');
  writeFileSync(join(output, 'report.json'), JSON.stringify(report) + '\n');
  return report;
}

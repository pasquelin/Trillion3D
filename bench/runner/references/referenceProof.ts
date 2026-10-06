// The class-2 image proof (CONTRIBUTING.md, "Image and fidelity"): `bench.ts --reference` holds each
// side's capture to the engine's reference image of its scene and view (`references/reference.ts`, #1281),
// through `referenceDiff`. A run that cannot be compared with it is refused by name, never scored.
import type { Capture } from '../../../tests/kit/server/staticServer.ts'
import { referenceDiff, type ReferenceDiff } from './imageDiff.ts'
import {
  REFERENCES_DIR,
  REFERENCE_IMAGES_DIR,
  readReference,
  referenceImage,
  settingsMismatch,
  type ReferenceRecord,
} from './referenceStore.ts'
import type { Report } from '../report/types.ts'

/** The scene's reference, once the run is known comparable: drawn from a commit, at the same
 *  image settings and pose path, on a still camera, with a reference for each of `views` —
 *  refused before any series runs rather than after it. */
export function sceneReference(
  report: Report,
  dir = REFERENCES_DIR,
  views: readonly string[] = [],
  images = REFERENCE_IMAGES_DIR,
): ReferenceRecord {
  const { scene, settings } = report
  const record = readReference(scene, dir)
  const refused = (why: string) => new Error(`--reference on ${scene}: ${why}`)
  if (!record)
    throw refused(
      `no reference image; draw it: node bench/runner/references/reference.ts --scene ${scene}`,
    )
  if (record.dirty)
    throw refused(`the reference was drawn from uncommitted changes on ${record.commit}`)
  const mismatch = settingsMismatch(record, settings)
  if (mismatch.length)
    throw refused(`this run's ${mismatch.join(', ')} differ from the reference's`)
  if (record.pathVersion !== report.pathVersion)
    throw refused(
      `the reference walks pose path ${record.pathVersion}, this run ${report.pathVersion}`,
    )
  if (settings.movingCamera) throw refused('a moving camera ends away from the reference pose')
  if (settings.movingLight) throw refused('a moving light ends away from the reference lights')
  const missing = views.filter((view) => !record.views[view])
  if (missing.length) throw refused(`no reference for ${missing.join(', ')}`)
  // Each image there and the one the record names, before any series runs.
  for (const view of views) referenceImage(record, view, images)
  return record
}

/** Same pose to a millionth of the scene's own coordinates: both are read off the same model. */
function samePose(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number')
    return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b))
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return a === b
  const keys = Object.keys(a)
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) =>
      samePose((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
    )
  )
}

/** Each side's capture of `series`, by side name, against the reference of its view. */
export function againstReference(
  record: ReferenceRecord,
  series: Report['series'][number],
  files: Record<string, string>,
  captures: ReadonlyMap<string, Capture>,
  images = REFERENCE_IMAGES_DIR,
): Record<string, ReferenceDiff> {
  const entry = record.views[series.view]
  if (!entry) throw new Error(`--reference: ${record.scene} has no reference for ${series.view}`)
  if (!samePose(entry.pose, series.pose))
    throw new Error(`--reference: ${record.scene} ${series.view} is not at the reference pose`)
  const reference = {
    name: `${record.scene}/${entry.file} @ ${record.commit.slice(0, 12)}`,
    capture: referenceImage(record, series.view, images),
  }
  return Object.fromEntries(
    Object.entries(files).map(([side, file]) => [
      side,
      referenceDiff(reference, captures.get(file)),
    ]),
  )
}

const diffText = (d: ReferenceDiff) =>
  !d
    ? '— | | |'
    : 'error' in d
      ? `${d.error} | | |`
      : `${d.reference} | ${d.meanChannel.toFixed(3)} | ${d.p999Channel} | ${d.flipMean.toFixed(4)}`

/** `resume.md`'s class-2 table; nothing when the run held no capture to a reference. */
export function referenceLines(report: Report) {
  const rows = report.series.flatMap((s) =>
    Object.entries(s.referenceDiff ?? {}).map(
      ([side, d]) => `| ${s.view} | ${s.pixelError} | ${side} | ${diffText(d)} |`,
    ),
  )
  if (!rows.length) return []
  return [
    '## Against the reference image (class 2)',
    '',
    'Channel errors in 1/255 steps, FLIP in [0, 1] (`references/imageDiff.ts::referenceDiff`).',
    '',
    '| view | pixelError | side | reference | mean | p99.9 | mean FLIP |',
    '|---|---|---|---|---|---|---|',
    ...rows,
    '',
  ]
}

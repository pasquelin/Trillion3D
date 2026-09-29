// The engine's reference images (#1281): where `reference.ts` writes them, what each carries, and
// how the class-2 proof (`referenceProof.ts`) reads them back.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { decodePng } from '../../packages/sdk-node/src/cutout/png.mts';
import type { CameraPose } from '../../packages/sdk-core/src/index.ts';
import type { Capture } from '../../tests/kit/server/staticServer.ts';
import type { BenchSettings } from './benchSettings.ts';

/** The published references, one folder per scene: `reference.json` and a PNG per view. */
export const REFERENCES_DIR = resolve(import.meta.dirname, '../references');

/** The proof scenes and the settings they are drawn at: the boss's case, 1728 × 1117 CSS at
 *  DPR 2, the sun and bounced light on the engine that draws them. A flag given after them wins. */
export const REFERENCE_SCENES = ['sponza', 'facade-7'];
export const REFERENCE_ARGS = [
  '--engine',
  'webgpu',
  '--width',
  '1728',
  '--height',
  '1117',
  '--dpr',
  '2',
  '--sun',
  '--bounce',
  'on',
  '--views',
  'overview,ground,street',
];

/** The settings that change the image: a capture drawn with other values is not comparable. */
export const IMAGE_SETTINGS = [
  'width',
  'height',
  'dpr',
  'lights',
  'lightShadows',
  'lightIntensity',
  'lightRangeFactor',
  'sun',
  'bounce',
  'importedLights',
  'instances',
] as const satisfies readonly (keyof BenchSettings)[];
export type ImageSettings = Pick<BenchSettings, (typeof IMAGE_SETTINGS)[number]>;

/** One reference view: its pose, its file, the resolved size and what holding it took. */
export interface ReferenceView {
  pose: CameraPose;
  file: string;
  sha256: string;
  width: number;
  height: number;
  settleFrames: number;
}

/** A scene's `reference.json`: the commit and command that drew it, and with what. */
export interface ReferenceRecord {
  scene: string;
  commit: string;
  /** Uncommitted changes in the tree the dist was built from: a reference drawn from them names
   *  no commit, and the proof refuses it. */
  dirty: boolean;
  from: string;
  command: string;
  generatedAt: string;
  pathVersion: number;
  engine: string;
  settings: ImageSettings;
  supersampling: number;
  approximations: readonly string[];
  views: Record<string, ReferenceView>;
}

export const imageSettings = (settings: BenchSettings): ImageSettings =>
  Object.fromEntries(IMAGE_SETTINGS.map((key) => [key, settings[key]])) as ImageSettings;

/** The image settings `settings` holds otherwise than `record`, by name; empty when comparable. */
export const settingsMismatch = (record: ReferenceRecord, settings: BenchSettings) =>
  IMAGE_SETTINGS.filter((key) => record.settings[key] !== settings[key]);

/** A scene's record, or `null` when it has no reference in `dir`. */
export function readReference(scene: string, dir = REFERENCES_DIR): ReferenceRecord | null {
  const file = join(dir, scene, 'reference.json');
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as ReferenceRecord) : null;
}

/** RGBA rows reversed: a PNG is top row first, a capture bottom row first, as the GPU reads it. */
export function flipRows(rgba: Uint8Array, width: number, height: number) {
  const out = new Uint8Array(rgba.length),
    stride = width * 4;
  for (let y = 0; y < height; y++)
    out.set(rgba.subarray(y * stride, (y + 1) * stride), (height - 1 - y) * stride);
  return out;
}

/** A view's reference image as a capture, bottom row first; `null` when the view has none. */
export function referenceImage(
  record: ReferenceRecord,
  view: string,
  dir = REFERENCES_DIR,
): Capture {
  const entry = record.views[view];
  if (!entry) return null;
  const { width, height, rgba } = decodePng(readFileSync(join(dir, record.scene, entry.file)));
  return { body: Buffer.from(flipRows(rgba, width, height)), w: width, h: height };
}

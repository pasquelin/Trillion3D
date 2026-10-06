// The engine's reference images (#1281): where `references/reference.ts` writes them, what each carries, and
// how the class-2 proof (`references/referenceProof.ts`) reads them back.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { decodePng } from '../../../packages/sdk-node/src/cutout/png.mts';
import { sha256 } from '../../../packages/sdk-node/src/compiler/provenance.mts';
import type { CameraPose } from '../../../packages/sdk-core/src/index.ts';
import type { Capture } from '../../../tests/kit/server/staticServer.ts';
import type { BenchSettings } from '../harness/benchSettings.ts';

/** The published references, one folder per scene: its `reference.json`, in git. */
export const REFERENCES_DIR = resolve(import.meta.dirname, '../../references');
/** Their images, a PNG per view, off git (`.mesure/`, AGENTS.md rule 10): `references/reference.ts` draws
 *  them there, and the SHA-256 of `reference.json` says which image each record names. */
export const REFERENCE_IMAGES_DIR = resolve(import.meta.dirname, '../../../.mesure/references');

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
const IMAGE_SETTINGS = [
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
interface ReferenceView {
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

/** A view's reference image as a capture, bottom row first as the GPU reads it (a PNG is top row
 *  first), decoded once per record and view; refused by name when absent or when its pixels are
 *  not the ones `reference.json` names. */
const decoded = new WeakMap<ReferenceRecord, Map<string, NonNullable<Capture>>>();
export function referenceImage(record: ReferenceRecord, view: string, dir = REFERENCE_IMAGES_DIR) {
  let images = decoded.get(record);
  if (!images) decoded.set(record, (images = new Map()));
  let image = images.get(view);
  if (image) return image;
  const { scene, commit, views } = record;
  const file = join(dir, scene, views[view].file);
  const redraw = `draw it at ${commit.slice(0, 12)}: node bench/runner/references/reference.ts --scene ${scene}`;
  if (!existsSync(file)) throw new Error(`no reference image ${file}; ${redraw}`);
  const { width, height, rgba } = decodePng(readFileSync(file), true);
  image = { body: Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength), w: width, h: height };
  if (sha256(image.body) !== views[view].sha256)
    throw new Error(`${file} is not the image reference.json names (SHA-256); ${redraw}`);
  images.set(view, image);
  return image;
}

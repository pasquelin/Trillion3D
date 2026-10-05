// Cases of defect 9 (`xformNormal`, `standardLighting.ts`): a world transform, a local normal, a
// light, and the true world normal in f64 by the graph's own normal matrix (`getNormalMatrix`, an
// inverse-transpose with no threshold).
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';
import type { Vec3 } from '../kit/vecTypes.ts';
import { DROPOUT_DEG, normalVerdict } from './inverseTransposeF32.ts';

/** The `scale ∘ rotation` pose `worldPose` and `lightingCase` take. */
export interface PoseParams {
  s: number;
  kind: 'uniform' | 'anisotropic';
  axis: Vec3;
  angleDeg: number;
}
/** What `lightNormals` reads of any case, campaign or singular: geometry, light, material. The
 *  singular cases (`normalTransformCases.ts`) also say whether they are singular or collapsed. */
export interface LitCase {
  name: string;
  world: number[];
  normal: Vec3;
  truth: Vec3;
  light: number[];
  metal: number;
  roughness: number;
  singular?: boolean;
  collapsed?: boolean;
}
/** A campaign case, as `lightingCase` builds it and `normalGap` reads it. */
export interface CampaignCase extends LitCase {
  s: number;
  kind: PoseParams['kind'];
}
/** One GPU row: the rendered normal and the two lit colours, with it and with the true one. */
export interface GpuRow {
  rendered: number[];
  litRendered: number[];
  litTrue: number[];
}

/** Rec. 709 luminance: a lit colour compared by a single number. */
export const luminance = ([r, g, b]: number[]): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** The light and material every case is lit with. */
export const LIT_MATERIAL = { light: [0.3, 0.8, 0.5, 3], metal: 0.1, roughness: 0.4 };

/**
 * The world transform `scale ∘ rotation` defects 6 and 9 both exercise: a `uniform` scale s on all
 * three axes (determinant s³) isolates the threshold defect, an `anisotropic` one (s, 1.7 s, 0.6 s)
 * checks a non-trivial inverse-transpose stays right. No translation: it moves neither a normal
 * nor a recentring.
 */
export function worldPose({ s, kind, axis, angleDeg }: PoseParams): G.Matrix4 {
  const scale = kind === 'uniform' ? [s, s, s] : [s, s * 1.7, s * 0.6];
  const rotation = new G.Quaternion().setFromAxisAngle(
    new G.Vector3(...axis).normalize(),
    (angleDeg * Math.PI) / 180,
  );
  return new G.Matrix4().compose(new G.Vector3(), rotation, new G.Vector3(...scale));
}

/** A pose, and the local normal, light and material it is lit with. */
interface LightingInput extends PoseParams {
  normal: Vec3;
  light: number[];
  metal: number;
  roughness: number;
}

/** The world transform, the local normal, and the true world normal in f64. */
export function lightingCase(input: LightingInput): CampaignCase {
  const { s, kind, axis, angleDeg, normal } = input;
  const world = worldPose({ s, kind, axis, angleDeg });
  const truth = new G.Vector3(...normal)
    .applyMatrix3(new G.Matrix3().getNormalMatrix(world))
    .normalize();
  return {
    ...input,
    name: `s=${s} ${kind} axis=${axis.join(',')} angle=${angleDeg}° n=${normal.join(',')}`,
    world: Array.from(world.elements),
    truth: [truth.x, truth.y, truth.z],
  };
}

/** The GPU's rendered normal judged against the true one (`normalVerdict`), and the relative
 *  luminance gap between the two colours the same BRDF lights on the same GPU. */
export function normalGap(lit: CampaignCase, row: GpuRow) {
  const truthLuminance = luminance(row.litTrue),
    renderedLuminance = luminance(row.litRendered);
  return {
    verdict: normalVerdict(row.rendered, lit.truth, DROPOUT_DEG),
    truthLuminance,
    renderedLuminance,
    luminanceGap: Math.abs(renderedLuminance - truthLuminance) / Math.max(truthLuminance, 1e-6),
  };
}

const SCALES = [1e3, 1, 1e-3, 1e-4, 1e-5, 1e-6, 2e-7, 1e-7, 1e-8, 1e-9, 1e-12, 1e-16];
const AXES = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
  [0.5773502691896258, 0.5773502691896258, 0.5773502691896258],
];
const ANGLES = [0, 37, 90, 137, 180];
const NORMALS = [
  [0, 0, 1],
  [0, 1, 0],
  [0.6, -0.8, 0],
];
const LIGHTS = [
  [0.3, 0.8, 0.5, 3],
  [-0.7, 0.2, 0.6, 2],
];

/** The full campaign: every scale crossed with orientations, normals and lights. */
export function campaign(): CampaignCase[] {
  return SCALES.flatMap((s) =>
    (['uniform', 'anisotropic'] as const).flatMap((kind) =>
      AXES.flatMap((axis) =>
        ANGLES.flatMap((angleDeg) =>
          NORMALS.flatMap((normal) =>
            LIGHTS.map((light) =>
              lightingCase({ s, kind, axis, angleDeg, normal, ...LIT_MATERIAL, light }),
            ),
          ),
        ),
      ),
    ),
  );
}

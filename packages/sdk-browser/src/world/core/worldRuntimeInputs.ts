import type { FrameMetrics, SceneFog, SceneToneMapping } from '../../../../sdk-core/src/index.ts';
import type { Camera } from '../../../../sdk-core/src/world/camera/camera.ts';
import type { openMeasuredWorld, MeasuredWorld } from '../session/explorer.ts';
import type { MeasuredWorldOptions } from '../session/options.ts';
import type { Scene } from './scene.ts';
import type { worldDiagnostic } from './worldHandles.ts';

/** What a world hands its runtime (`worldRuntime.ts`): its canvas, scene and camera, the session
 *  options of the moment, and the hooks that hear each session and frame. */
export type WorldRuntimeInputs = {
  canvas: HTMLCanvasElement;
  scene: Scene;
  camera: () => Camera;
  /** The session options of the moment: renderer, pools, loop and hooks. */
  options: () => MeasuredWorldOptions;
  /** Runs on every new session, before its first frame: diagnostic mode, pools. */
  opened: (explorer: MeasuredWorld) => void;
  frame: (metrics: FrameMetrics) => void;
  /** What the page set: exposure, curve and fog; the lights add their irradiance. */
  display: () => { exposure: number; toneMapping: SceneToneMapping; fog?: SceneFog };
  /** Whether the world has drawn a frame yet. */
  drawn: () => boolean;
  /** Settles once the world's renderer — and its device — is granted, a lost one asked again. */
  ready: () => Promise<unknown>;
  /** The world's notices; each opening, tried or not; a session or a scene that failed, kept. */
  diagnostic: Pick<ReturnType<typeof worldDiagnostic>, 'notices' | 'failed' | 'opening'>;
  /** Opens a session; stands for the engine's own. */
  open?: typeof openMeasuredWorld;
};

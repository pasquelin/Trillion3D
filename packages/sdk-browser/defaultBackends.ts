import { EngineError, type ClusterManifest } from '../sdk-core/index.ts';
import type { BackendFactory } from './backendTypes.ts';
import { autonomousPagesBackend } from './autonomousPages.ts';
import { webgpuPagesBackend } from './webgpuPages.ts';

/** What renders when the host named nothing, and why that path and not another. */
export type BackendChoice = {
  factories: BackendFactory[];
  /** The session reads the cache's prepared scene and its geometry pages, not `source.gltf`. */
  autonomous: boolean;
  /** `host` = the list came from the options; `default` = the engine chose it from the machine. */
  origin: 'host' | 'default';
  /** Short sentence naming the capability that decided; reported as a diagnostic. */
  reason: string;
  /** Id of the backend that draws, or `null` when the host named the list itself. */
  renderer: string | null;
};

/** True when the cache carries what the autonomous WebGL2 path reads. */
export function autonomousCacheReady(metadata: ClusterManifest) {
  return typeof metadata.autonomousScene === 'string' && metadata.autonomousScene.length > 0;
}

/** A choice before its default: a path is not autonomous unless it says so. */
type Decided = Omit<BackendChoice, 'autonomous'> & Partial<Pick<BackendChoice, 'autonomous'>>;

/** The paths of a session the host left to the engine: the WebGPU page raster where a device was
 *  granted, the engine's own WebGL2 page path otherwise. The Three witnesses
 *  (`referenceBackend`, `exactPagesBackend`, `threeLodBackend`) are never chosen on their own
 *  merit: a host that wants one, for a comparison view or the bench, names it in
 *  `options.backends`. A machine offering neither WebGPU nor WebGL2 fails by name. */
export function chooseBackends(
  options: { backends?: BackendFactory[]; autonomousGeometry?: boolean },
  metadata: ClusterManifest,
  gpuDevice: GPUDevice | undefined,
  webgl2 = true,
): BackendChoice {
  // `autonomous` is stated, never derived from the factory: a host list naming the autonomous
  // backend without `autonomousGeometry` keeps reading `source.gltf`, as it always has.
  const choice = (part: Decided): BackendChoice => ({ autonomous: false, ...part });
  if (options.autonomousGeometry === true) {
    if (options.backends || !autonomousCacheReady(metadata))
      throw new EngineError(
        'AUTONOMOUS_SCENE_UNAVAILABLE',
        'Autonomous geometry requires a prepared static scene and the autonomous backend',
      );
    return choice({
      factories: [autonomousPagesBackend],
      autonomous: true,
      origin: 'host',
      reason: 'the host asked for the autonomous WebGL2 path',
      renderer: 'autonomous-pages-webgl',
    });
  }
  // A host list is taken as it stands, witnesses included; only a single-entry autonomous list
  // reads the cache's prepared scene, and that list is the one above.
  if (options.backends)
    return choice({
      factories: options.backends,
      origin: 'host',
      reason: 'the host named the backends itself',
      renderer: null,
    });
  if (gpuDevice)
    return choice({
      factories: [webgpuPagesBackend],
      origin: 'default',
      reason: 'a WebGPU device was granted',
      renderer: 'webgpu-page-raster',
    });
  if (!webgl2)
    throw new EngineError(
      'NO_ENGINE_BACKEND',
      'No engine path is available: this machine granted neither a WebGPU device nor a WebGL2 ' +
        'context. Name a backend in options.backends to render anyway.',
    );
  // Until the compiler writes a prepared scene for a cache that blends, it writes none at all:
  // one `clustered-blend` primitive is enough for it to refuse. The same page path draws either
  // cache — only the file it reads its materials and placements from changes.
  const prepared = autonomousCacheReady(metadata);
  return choice({
    factories: [autonomousPagesBackend],
    autonomous: prepared,
    origin: 'default',
    reason: prepared
      ? 'no WebGPU device; the cache carries a prepared autonomous scene'
      : 'no WebGPU device and no prepared autonomous scene; the same path reads source.gltf',
    renderer: 'autonomous-pages-webgl',
  });
}

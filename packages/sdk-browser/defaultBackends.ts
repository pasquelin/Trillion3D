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
};

/** True when the cache carries what the autonomous WebGL2 path reads. */
export function autonomousCacheReady(metadata: ClusterManifest) {
  return typeof metadata.autonomousScene === 'string' && metadata.autonomousScene.length > 0;
}

/** The engine's own paths, in the order the machine allows them: the WebGPU page raster where a
 *  device was granted, the autonomous WebGL2 path otherwise. The Three witnesses
 *  (`referenceBackend`, `exactPagesBackend`, `threeLodBackend`) are never chosen here: a host
 *  that wants one, for a comparison view or the bench, names it in `options.backends`. A machine
 *  that offers neither path fails by name instead of rendering through a witness. */
export function chooseBackends(
  options: { backends?: BackendFactory[]; autonomousGeometry?: boolean },
  metadata: ClusterManifest,
  gpuDevice: GPUDevice | undefined,
): BackendChoice {
  // `autonomous` is stated, never derived from the factory: a host list naming the autonomous
  // backend without `autonomousGeometry` keeps reading `source.gltf`, as it always has.
  const choice = (
    factories: BackendFactory[],
    autonomous: boolean,
    origin: BackendChoice['origin'],
    reason: string,
  ): BackendChoice => ({ factories, autonomous, origin, reason });
  if (options.autonomousGeometry === true) {
    if (options.backends || !autonomousCacheReady(metadata))
      throw new EngineError(
        'AUTONOMOUS_SCENE_UNAVAILABLE',
        'Autonomous geometry requires a prepared static scene and the autonomous backend',
      );
    return choice(
      [autonomousPagesBackend],
      true,
      'host',
      'the host asked for the autonomous WebGL2 path',
    );
  }
  // A host list is taken as it stands, witnesses included; only a single-entry autonomous list
  // reads the cache's prepared scene, and that list is the one above.
  if (options.backends)
    return choice(options.backends, false, 'host', 'the host named the backends itself');
  if (gpuDevice)
    return choice([webgpuPagesBackend], false, 'default', 'a WebGPU device was granted');
  if (autonomousCacheReady(metadata))
    return choice(
      [autonomousPagesBackend],
      true,
      'default',
      'no WebGPU device; the cache carries a prepared autonomous scene',
    );
  throw new EngineError(
    'NO_ENGINE_BACKEND',
    'No engine path is available: WebGPU was refused and this cache carries no prepared scene ' +
      'for the autonomous WebGL2 path. Name a backend in options.backends to render anyway.',
  );
}

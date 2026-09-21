import { EngineError } from '../sdk-core/index.ts';

/**
 * The one named refusal of the autonomous WebGL2 path: at preparation, where it fails the
 * backend, and on any later frame, where a mutation or a lost capability raises it before a
 * draw. `details.reason` names the input; nothing else draws paged clusters, so a refusal is
 * never a partial image.
 */
export const clusterRefusal = (reason: string) =>
  new EngineError('CLUSTER_MATERIAL_UNSUPPORTED', `Autonomous WebGL2 refused: ${reason}`, {
    reason,
  });
export function refuseCluster(reason: string): never {
  throw clusterRefusal(reason);
}

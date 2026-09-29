import { EngineError } from '../../../../sdk-core/src/index.ts';

/**
 * The one named refusal of the autonomous WebGL2 path: at preparation, where it fails the
 * backend, and on any later frame, where a light or a lost capability raises it before a draw.
 * A surface the gate refuses is no frame refusal: it alone is left out, by name
 * (`validation.ts`). `details.reason` names the input.
 */
export const clusterRefusal = (reason: string) =>
  new EngineError('CLUSTER_MATERIAL_UNSUPPORTED', `Autonomous WebGL2 refused: ${reason}`, {
    reason,
  });
export function refuseCluster(reason: string): never {
  throw clusterRefusal(reason);
}

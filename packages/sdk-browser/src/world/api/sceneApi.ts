import { EngineError } from '../../../../sdk-core/src/index.ts';
import type {
  AssetScope,
  CameraPose,
  FrameMetrics,
  Material,
  StablePreview,
} from '../../../../sdk-core/src/index.ts';
import type { RenderBackend } from '../../backend/types.ts';
import { DEFAULT_CLEAR_COLOR } from '../../backend/common.ts';
import type { DecodedGeometryPage } from '../../page/decode/geometryPage.ts';
import type { MemoryBudgets } from '../../residency/pools.ts';
import type { PlacementRows } from '../../placement/rows.ts';

type Inputs = {
  check: () => void;
  active: () => RenderBackend;
  backends: RenderBackend[];
  render: (pose?: CameraPose) => FrameMetrics;
  flush: () => Promise<void>;
  capture: () => Uint8Array;
  scope: AssetScope;
  canvas: HTMLCanvasElement;
};

export function createExplorerSceneApi(inputs: Inputs) {
  const { check, active: getActive, backends, render, flush, capture, scope, canvas } = inputs;
  return {
    /**
     * Sets memory pools of the active engine during the session — what a settings slider
     * calls. The engine keeps what fits in the new pool, and the report says what it really
     * holds (`clamp` when the value was brought back) and what the setting cost.
     */
    async setMemoryBudgets(budgets: MemoryBudgets) {
      check();
      const active = getActive();
      if (!active.setMemoryBudgets)
        throw new EngineError(
          'UNSUPPORTED_MEMORY_BUDGETS',
          `${active.id} does not support memory budgets`,
        );
      return active.setMemoryBudgets(budgets);
    },
    addInstance(id: string, transform: Float64Array) {
      check();
      const active = getActive();
      if (!active.addInstance)
        throw new EngineError(
          'UNSUPPORTED_SCENE_UPDATE',
          `${active.id} does not support instance insertion`,
        );
      active.addInstance(id, transform);
    },
    updateInstance(id: string, transform: Float64Array) {
      check();
      const active = getActive();
      if (!active.updateInstance)
        throw new EngineError(
          'UNSUPPORTED_SCENE_UPDATE',
          `${active.id} does not support instance transforms`,
        );
      active.updateInstance(id, transform);
    },
    removeInstance(id: string) {
      check();
      const active = getActive();
      if (!active.removeInstance)
        throw new EngineError(
          'UNSUPPORTED_SCENE_UPDATE',
          `${active.id} does not support instance removal`,
        );
      active.removeInstance(id);
    },
    /** Rows `from` to `to` of an instance buffer the session holds were written. */
    updatePlacements(rows: PlacementRows, from: number, to: number) {
      check();
      const active = getActive();
      if (!active.updatePlacements)
        throw new EngineError(
          'UNSUPPORTED_SCENE_UPDATE',
          `${active.id} does not support instance-buffer rows`,
        );
      active.updatePlacements(rows, from, to);
    },
    /** Whether the active path grows an instance buffer in place (`growPlacements`). */
    growsPlacements: () => !!getActive().growPlacements,
    /** An instance buffer the session holds was replaced by a larger one (`placement/growth.ts`). */
    growPlacements(from: PlacementRows, to: PlacementRows) {
      check();
      const active = getActive();
      if (!active.growPlacements)
        throw new EngineError(
          'UNSUPPORTED_SCENE_UPDATE',
          `${active.id} does not grow instance buffers in place`,
        );
      active.growPlacements(from, to);
    },
    /** Bounced light on or off in the session; false when the active path cannot toggle it in
     *  place, and only a session opened with the other setting will have it. */
    setBounce(on: boolean) {
      check();
      const active = getActive();
      active.setBounce?.(on);
      return !!active.setBounce;
    },
    /** The clear colour behind the scene, `0xrrggbb` or the default, on every engine of the
     *  session; false when the active path cannot take it in place, and only a new session will. */
    setClearColor(hex = DEFAULT_CLEAR_COLOR) {
      check();
      for (const backend of backends) backend.setClearColor?.(hex);
      return !!getActive().setClearColor;
    },
    /** Host surfaces rewritten in place are read again; false when the active path cannot, and
     *  only a new session will draw them. */
    refreshMaterials() {
      check();
      const active = getActive();
      active.refreshMaterials?.();
      return !!active.refreshMaterials;
    },
    updateMaterial(primitive: string, material: Material) {
      check();
      const active = getActive();
      if (!active.updateMaterial)
        throw new EngineError(
          'UNSUPPORTED_SCENE_UPDATE',
          `${active.id} does not support material updates`,
        );
      active.updateMaterial(primitive, material);
    },
    replaceGeometryPage(url: string, data: DecodedGeometryPage) {
      check();
      const active = getActive();
      if (!active.replaceGeometryPage)
        throw new EngineError(
          'UNSUPPORTED_SCENE_UPDATE',
          `${active.id} does not support geometry page updates`,
        );
      active.replaceGeometryPage(url, data);
      active.syncResident?.();
    },
    async renderViews(poses: readonly CameraPose[]): Promise<StablePreview[]> {
      check();
      const views: StablePreview[] = [];
      for (const pose of poses) {
        render(pose);
        await flush();
        const rgba = capture();
        views.push({
          scope,
          origin: 'bottom-left',
          rgba: rgba.slice(),
          width: canvas.width,
          height: canvas.height,
          backend: getActive().id,
        });
      }
      return views;
    },
    refreshSceneLighting() {
      check();
      for (const backend of backends) backend.refreshSceneLighting?.();
    },
  };
}

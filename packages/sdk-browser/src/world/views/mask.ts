import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import type { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts';
import type { Seat } from '../core/worldBatches.ts';
import { shownUnder, type PosedTwin, createWorldPoses } from '../core/worldPoses.ts';
import type { PlacementRows } from '../../placement/rows.ts';
import type { SceneLightStore } from '../../../../sdk-core/src/scene/light/store.ts';
import { castsShadow } from '../../../../sdk-core/src/scene/light-shadow/casters.ts';
import { LIGHT_KIND } from '../../../../sdk-core/src/scene/light/contracts.ts';

/** Lamp pages are shared across cameras; different caster sets require a per-mask atlas key. */
export function checkViewMaskLights(store?: SceneLightStore) {
  if (!store) return;
  for (let slot = 0; slot < store.count; slot++)
    if (store.kindOf(slot) !== LIGHT_KIND.directional && castsShadow(store, slot))
      throw new Error('VIEW_EXCLUDE_SHADOW_LAMP_UNSUPPORTED');
}

/** Temporarily parks only excluded subtrees in the existing placement rows, including their shadows. */
export function createViewMask(
  scene: Object3D,
  seats: ReadonlyMap<Mesh, Seat>,
  twins: () => ReadonlyMap<Object3D, PosedTwin>,
  send: (rows: PlacementRows, from: number, to: number) => void,
  validate = () => {},
) {
  const poses = createWorldPoses();
  const empty = new Map<Object3D, PosedTwin>();
  return (excluded: readonly Object3D[], draw: () => void) => {
    if (!excluded.length) return draw();
    validate();
    const touched = new Set<Object3D>();
    const write = (node: Object3D, visible: boolean) => {
      const seat = seats.get(node as Mesh);
      if (seat) poses.writeSeat(node as Mesh, seat, visible);
      const twin = twins().get(node);
      if (twin) poses.writeTwin(node, twin, visible);
    };
    const flush = () => poses.apply(scene, seats, empty, send);
    try {
      for (const parent of excluded)
        parent.traverse((node) => {
          if (touched.has(node)) return;
          touched.add(node);
          write(node, false);
        });
      flush();
      draw();
    } finally {
      for (const node of touched) write(node, shownUnder(node, scene));
      flush();
    }
  };
}

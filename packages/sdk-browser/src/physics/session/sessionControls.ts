import type { WaterSpec } from '../../../../sdk-core/src/fluids/index.ts';
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import { hasBody } from '../bodies.ts';
import { followMove } from '../nodePose.ts';
import { placeBodies } from '../placeBodies.ts';
import type { SessionParts } from './sessionParts.ts';
import { engineIdOf } from '../simulatedIds.ts';
import { drawnBySoft } from '../softBodies.ts';

/** What the world asks of a session between its frames: its clock, its water, the scene's changes,
 *  its queries and its end. */
export function createSessionControls(c: SessionParts) {
  const { s, clock, worker, writer, bodies, tiles } = c;
  return {
    /** Pauses or scales the simulation's time; a scale of 0 stands still, like a pause. */
    setClock(paused: boolean, timeScale: number) {
      Object.assign(clock, { paused: paused || timeScale === 0, timeScale });
    },
    /** The water, or none (buoyancy in the worker): each dynamic body woken, to float or fall.
     *  Its waves start at 0 s at the page's step now. */
    setWater(water: WaterSpec | null) {
      // The step the worker stands at when it reads this: the steps this frame owes come after.
      s.waterAt = clock.steps - s.owed;
      worker.postMessage({ type: 'water', water, at: s.waterAt });
      for (const mesh of bodies.meshes)
        if (mesh?.physics.type === 'dynamic') writer.wake(mesh.physics._index);
      for (const slot of bodies.nested.keys()) writer.wake(slot);
    },
    /** Simulated seconds the water's waves have run at the time the last frame drew: the
     *  waves buoyancy met there. */
    waterTime: () => clock.since(s.waterAt),
    /** The scene's tree changed: bodies are reconciled before the next frame. */
    structure: () => void (s.dirty = true),
    /** A mesh's geometry, material or `physics` changed: not a soft body drawn where it is. */
    content(node: Object3D) {
      if (drawnBySoft(node)) return;
      if (hasBody(node)) c.stale.add(node);
      s.dirty = true;
    },
    /** The page moved or hid a node: its bodies go where the page put them; hidden, no pose. */
    pose(node: Object3D) {
      s.dirty = placeBodies(node, bodies, writer, c.failed) || s.dirty;
      tiles.moved(node);
      followMove(node, bodies.nested, writer, c.poses.follow);
    },
    /** Scene queries (`CAST_WORDS` each), answered after the frame's commands: hits in order. */
    async cast(queries: Uint32Array) {
      await c.started;
      c.link.flush();
      const id = ++s.asked;
      worker.postMessage({ type: 'cast', id, queries }, [queries.buffer]);
      return new Promise<Uint32Array>((resolve) => c.casts.set(id, resolve));
    },
    /** The model a tile body's engine id belongs to, or the mesh a body's names, or `null`. */
    objectOf: bodies.slots.objectOf,
    /** The engine id of `node`'s body; -1 while it is not simulated. */
    engineIdOf: (node: Object3D) => engineIdOf(bodies, node),
    /** The glTF material of a tile body's triangles, `-1` for any other body. */
    materialOf: tiles.materialOf,
    dispose() {
      tiles.clear();
      c.joints.clear();
      c.vehicles.clear();
      bodies.clear();
      c.poses.clear();
      writer.take();
      worker.terminate();
    },
  };
}

/**
 * WHAT COUNTS AS A BODY: a mesh the simulation holds one for.
 *
 * `hasBody` and `Bodied` read a node's physics and nothing else — they create, place and step
 * nothing. Held in `bodies.ts`, beside `createPhysicsBodies`, they made the modules that only ask
 * whether a node has a body (`simulatedIds.ts`, `bodySlots.ts`) import the module that builds them,
 * and the package formed a ring.
 *
 * So what a body is lives here, and `bodies.ts` keeps what is about the simulation: its slots, its
 * flags, its poses.
 */

import type { Mesh } from '../../../sdk-core/src/world/object/mesh.ts';
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts';

/** A mesh the simulation holds a body for. */
export type Bodied = Mesh & { physics: NonNullable<Mesh['physics']> };

/** Whether `node` is a mesh with physics set. A world may hold objects of any kind, and only the
 *  ones the simulation was given a body for are stepped, posed and read back. */
export const hasBody = (node: Object3D): node is Bodied =>
  (node as { physics?: unknown }).physics != null;
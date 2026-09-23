import { build, materialOf, type AddKind } from './objects.ts';
import type { Session } from './session.ts';

/** The public cooked models the Models menu loads, each committed under `site/assets/examples`. */
export const MODELS = ['marble-bust', 'crates', 'hall', 'street-corner'] as const;
export type ModelId = (typeof MODELS)[number];
export const manifestOf = (id: ModelId) =>
  new URL(`assets/examples/${id}/cache/native/full/manifest.json`, document.baseURI).href;

/** What the starter scene's objects are called, in the page's language. */
export interface StarterNames {
  kind: (kind: AddKind) => string;
  pedestal: string;
  bust: string;
}

interface Look {
  color: string;
  roughness: number;
  metalness?: number;
  at: [number, number, number];
}

/** A shape of the starter scene, built from `size` and placed at `look.at`, in its own matter. */
function shape(session: Session, kind: AddKind, name: string, size: number[], look: Look) {
  const node = build(session.engine, kind, name, size);
  const matter = materialOf(node)!;
  matter.color.set(look.color);
  Object.assign(matter, { roughness: look.roughness, metalness: look.metalness ?? 0 });
  node.position.set(...look.at);
  return node;
}

/**
 * The scene the editor opens on when this browser has saved none: a light stone pedestal on the
 * grid with the marble bust on it, a sphere beside it, the sun and a soft fill, and the camera
 * framing them. It is a scene like any other: every object is selected, moved or deleted.
 */
export async function buildStarter(session: Session, names: StarterNames) {
  const { engine, world } = session;
  const pedestal = shape(session, 'cylinder', names.pedestal, [0.3, 0.34, 1, 48], {
    color: '#e6e0d4',
    roughness: 0.8,
    at: [0, 0.5, 0],
  });
  const sphere = shape(session, 'sphere', names.kind('sphere'), [0.4, 48, 24], {
    color: '#d0703f',
    roughness: 0.35,
    metalness: 0.1,
    at: [1.1, 0.4, 0.6],
  });
  const sun = build(engine, 'directional', names.kind('directional'));
  const fill = build(engine, 'ambient', names.kind('ambient'));
  world.scene.add(pedestal, sphere, sun, fill);
  world.camera.position.set(2.6, 2, 3.4);
  world.camera.lookAt(0.4, 0.8, 0);
  world.controls.target?.set(0.4, 0.8, 0);
  // The bust stands on the pedestal's top; the loader adds it to the scene.
  const bust = await world.scene.load(manifestOf('marble-bust'));
  bust.name = names.bust;
  bust.position.y = 1;
}

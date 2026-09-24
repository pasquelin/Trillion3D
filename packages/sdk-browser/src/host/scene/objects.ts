/**
 * The host-library objects a witness hangs on the display graph it publishes: the background
 * colour, the lights copied from the source graph, the empty node a copied light aims at, and
 * the colour a diagnostic paints a cluster with.
 *
 * What reaches this file is every engine whose image the HOST RENDERER draws — the reference,
 * exact and level-of-detail witnesses, and the autonomous WebGL2 path, which is a shipping
 * backend and not a witness at all (`../pageObjects.ts`) — through the scene adapter and the
 * contract-lighting API they share. The engine that presents its own surface publishes a
 * display-graph record instead (`../../cluster/blendSceneRecord.ts`) and names no library: the constants and
 * the frame budgets it still shares with the others stayed in `../../backend/common.ts`, which imports
 * nothing.
 */
import { installSceneLighting } from '../../lighting/sceneLighting.ts';
import { clusterHue } from '../../diagnostic/colors.ts';
import { asHostLibrary, type HostPlaced, type HostTraversable } from '../resources.ts';
import type { HostDrawScene } from './graphNodes.ts';
import { hslToLinearRgb } from '../../../../sdk-core/src/index.ts';
import * as THREE from 'three';

/** Three linear components reread immediately: a cluster colour allocates nothing more. */
const tint = new Float64Array(3);

/** A cluster's hue, computed by the core. The colour object returned is the one host
 *  materials want; its construction is the boundary, not the computation. */
export function clusterColor(id: string, saturation = 0.75) {
  hslToLinearRgb(tint, 0, clusterHue(id), saturation, 0.55);
  return new THREE.Color(tint[0], tint[1], tint[2]);
}
/** An empty node of a host display graph: what a copied light aims at, made here because
 *  making a host object is the boundary's, and posed by the placement that asked for it. */
export const hostAimNode = () => new THREE.Object3D() as unknown as HostPlaced;

/** The clear colour a host-rendered engine publishes, the one the composer clears with
 *  (`world/render/compose.ts`). */
const paint = (scene: HostDrawScene, clearColor: number) => {
  asHostLibrary<THREE.Scene>(scene).background = new THREE.Color(clearColor);
};

/** What sets that colour during the session, then tells `changed` the image moved: a held frame
 *  would otherwise put the old colour back. */
export const hostBackground = (scene: HostDrawScene, changed: () => void) => (hex: number) => {
  paint(scene, hex);
  changed();
};

/** The display graph a host-rendered engine publishes: its clear colour, then the source-graph
 *  lights placed on it. Building the host objects is the boundary's, the placement is not. */
export function lighting(scene: HostDrawScene, clearColor: number, source: HostTraversable) {
  paint(scene, clearColor);
  return installSceneLighting(scene, source, hostAimNode);
}

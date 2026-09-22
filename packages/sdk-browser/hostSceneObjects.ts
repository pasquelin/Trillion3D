/**
 * The host-library objects a witness hangs on the display graph it publishes: the background
 * colour, the lights copied from the source graph, the empty node a copied light aims at, and
 * the colour a diagnostic paints a cluster with.
 *
 * Only witnesses reach this file — the reference and exact engines, the level-of-detail witness,
 * the shared scene adapter and the contract-lighting API they share. The engine path publishes
 * its own display-graph record instead (`blendSceneRecord.ts`) and names no library: the
 * constants and the frame budgets it still shares with the witnesses stayed in
 * `backendCommon.ts`, which imports nothing.
 */
import { installSceneLighting } from './sceneLighting.ts';
import { clusterHue } from './diagnosticColors.ts';
import type { HostPlaced, HostTraversable } from './hostResources.ts';
import { hslToLinearRgb } from '../sdk-core/index.ts';
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

/** The display graph a witness publishes: its clear colour, then the source-graph lights
 *  placed on it. Building the host objects is the boundary's, the placement is not. */
export function lighting(scene: THREE.Scene, clearColor: number, source: HostTraversable) {
  scene.background = new THREE.Color(clearColor);
  return installSceneLighting(scene, source, hostAimNode);
}

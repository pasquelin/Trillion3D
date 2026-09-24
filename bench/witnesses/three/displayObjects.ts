/**
 * The host-library objects a witness hangs on the display graph it publishes: the background
 * colour, the lights copied from the source graph and the empty node a copied light aims at.
 *
 * What reaches this file is every witness whose image the REFERENCE RENDERER draws — the
 * reference and level-of-detail witnesses — through the scene adapter. The engine's own WebGL2
 * paths light a display graph of the engine's own objects
 * (`packages/sdk-browser/src/lighting/contractLightingApi.ts`), and the engine that presents its own surface
 * publishes a display-graph record (`packages/sdk-browser/src/cluster/blendSceneRecord.ts`): neither names a
 * library. A light of the engine's own graph is copied into the library by `fromGraphNodes.ts`.
 */
import {
  installSceneLighting,
  type HostLight,
} from '../../../packages/sdk-browser/src/lighting/sceneLighting.ts';
import type { GraphLight } from '../../../packages/sdk-browser/src/host/graph/light.ts';
import {
  asHostLibrary,
  type HostPlaced,
  type HostTraversable,
} from '../../../packages/sdk-browser/src/host/resources.ts';
import type { HostDrawScene } from '../../../packages/sdk-browser/src/host/scene/graphNodes.ts';
import { threeLight } from './fromGraphNodes.ts';
import * as THREE from 'three';

/** An empty node of a host display graph: what a copied light aims at, made here because
 *  making a host object is the boundary's, and posed by the placement that asked for it. */
export const hostAimNode = () => new THREE.Object3D() as unknown as HostPlaced;

/** The display graph a host-rendered engine publishes: its clear colour, then the source-graph
 *  lights placed on it. Building the host objects is the boundary's, the placement is not. */
export function lighting(scene: HostDrawScene, clearColor: number, source: HostTraversable) {
  asHostLibrary<THREE.Scene>(scene).background = new THREE.Color(clearColor);
  return installSceneLighting(scene, source, hostAimNode, (light) =>
    asHostLibrary<HostLight>(threeLight(asHostLibrary<GraphLight>(light))),
  );
}

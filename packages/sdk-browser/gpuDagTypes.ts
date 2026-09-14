import * as THREE from 'three';
import type { NormalCone } from './pageCone.ts';

export const CLUSTER_FLOATS = 16,
  DAG_NODE_FLOATS = 16,
  FRAME_VEC4 = 7,
  CULL_STRIDE = 15;
export const CLUSTER_ROOT = 1,
  CLUSTER_NEVER = 2;
/** Rounds of ancestor escalation before the pinned root cover takes over. */
export const DAG_ESCALATION_ROUNDS = 3;

export type DagCluster = {
  url: string;
  lodError?: number;
  parentError?: number | null;
  sphere?: number[];
  parentSphere?: number[] | null;
  level?: number;
  min?: number[];
  max?: number[];
  cone?: NormalCone;
  material?: THREE.Material | THREE.Material[];
};
export type DagRoot = {
  world: THREE.Matrix4;
  pages: DagCluster[];
  flat?: boolean;
  culling?: { nodes: Float64Array; stride: number };
};
export type PackedDag = {
  kind: 'dag';
  clusters: Float32Array;
  nodes: Float32Array;
  pageCones: Float32Array;
  worlds: Float32Array;
  worldStretch: Float32Array;
  nodeCount: number;
  worldCount: number;
  pageCount: number;
  rootCount: number;
  pageUrls: string[];
};

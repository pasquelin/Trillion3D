import type * as THREE from 'three';

export type HizPage = {
  min: number[];
  max: number[];
  matrix: THREE.Matrix4;
  url?: string;
  clusterId?: string;
};
export type HizBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  nearestDepth: number;
  clipsNear: boolean;
};
export type HizPyramid = { levels: number[][][]; width: number; height: number };

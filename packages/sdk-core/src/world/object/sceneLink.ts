import type { Object3D } from './object3d.ts';

/** What a node reports to the world it hangs in: a pose moved, the tree changed, a content changed. */
export interface SceneLink {
  /** A node moved. */ pose(node: Object3D): void;
  /** Many nodes moved at once, written straight into their tree (the physics' bodies): told once. */
  posed(nodes: readonly Object3D[]): void;
  /** A node gained or lost children. */ structure(node: Object3D): void;
  /** A node's shape or material changed. */ content(node: Object3D): void;
}

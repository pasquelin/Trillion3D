// The graph the engine reads is the engine's own (`graph/`): every name below is one of its
// classes, read by its `kind` and its fields, never by a library's brand. The plain data a
// reader shares with the witnesses — a colour, a box, the diagnostic factory — stays a shape.
// The 4×4 pose is `MatrixElements` (`matrixElements.ts`).
import type { GraphElements } from './graph/attributes.ts';
import type { GraphGeometry } from './graph/geometry.ts';
import type { GraphMesh } from './graph/mesh.ts';
import type { GraphNode } from './graph/node.ts';
import type { GraphSurface } from './graph/surface.ts';
import type { GraphTexture } from './graph/texture.ts';

/** A texture of the graph: a decoded picture or raw texels, and the sampler state it declares. */
export type HostTexture = GraphTexture;

/** One vertex attribute of a geometry, owning its storage or viewing an interleaved one. */
export type HostAttribute = GraphElements;

/** The named attributes of one geometry. Also an identity: the engine keys its GPU buffers,
 *  geometry blocks and position caches on the attribute set a page draws from. */
export type HostAttributes = { [name: string]: GraphElements };

/** One corner of a local bound, as the host writes it. */
export type HostPoint = {
  /** Left to right. */ readonly x: number;
  /** Bottom to top. */ readonly y: number;
  /** Back to front. */ readonly z: number;
};

/** A local or world box of the host, read by its two corners (`boxBounds.ts`). */
export type HostBox = {
  /** The lowest corner. */ readonly min: HostPoint;
  /** The highest corner. */ readonly max: HostPoint;
};

/** A geometry of the graph: its attributes, its triangle list and the local box over them. */
export type HostGeometry = GraphGeometry;

/** A host resource the engine frees when the graph it came from is released: a geometry, a
 *  surface, a texture. The engine never builds one, so freeing it is giving it back. */
export type HostDisposable = {
  /** Frees it. */
  dispose(): void;
};

/** A surface of the graph, of the family it declares. */
export type HostMaterial = GraphSurface;

/** What a mesh wears: one surface, or one per geometry group. */
export type HostMaterials = GraphSurface | GraphSurface[];

/** A drawn node of the graph, held by identity: the draw record, the transparent table and the
 *  selection sets name the mesh the engine placed. */
export type HostMesh = GraphMesh;

/** A node of the graph, held by identity: walked, placed and posed through its own fields. */
export type HostNode = GraphNode;

/** A node placed in a display graph: the pose the engine writes on it, the world matrix it
 *  resolves for its chain. */
export type HostPlaced = GraphNode;

/** A node the engine walks: the subtree under it, itself first. */
export type HostTraversable = GraphNode;

/** A host colour: three linear components, read one by one and written the same way. The engine
 *  never converts here — a colour crosses as the host holds it. */
export type HostColour = {
  /** Red, linear. */ r: number;
  /** Green, linear. */ g: number;
  /** Blue, linear. */ b: number;
};

/** The display graph an engine publishes, as a composition reads it: the clear colour, the
 *  children and the walk. It is the engine's own (`graph/scene.ts`) or the record of the
 *  transparent copies (`../cluster/blendSceneRecord.ts`), whose nodes carry no `kind` and are
 *  skipped by every guard of `graph/kinds.ts`. */
export type HostScene = {
  /** What fills the image behind. */ readonly background: unknown;
  /** The nodes at its top. */ readonly children: readonly object[];
  /** Visits itself, then the subtree. */ traverse(visit: (node: object) => void): void;
};

/** A surface a diagnostic view swaps onto a mesh, then frees. The diagnostic views also serve the
 *  witnesses, whose meshes are their library's: what they hang arrives through
 *  `HostDiagnosticFactory`, and they are read by this shape alone. */
export type HostDiagnosticMaterial = HostDisposable & {
  /** Which faces, as the engine's constant (`../scene/materialSide.ts`). */ readonly side: number;
  /** A copy of the surface. */ clone(): HostDiagnosticMaterial;
};
/** A geometry a diagnostic view reads the vertex count of, and may free. */
export type HostDiagnosticGeometry = HostDisposable & {
  /** Its vertex attributes, of which a view reads the count. */
  readonly attributes: { readonly [name: string]: { readonly count: number } };
};
/** A mesh a diagnostic view repaints: its surface and geometry swapped, its identity a seed. */
export type HostDiagnosticMesh = {
  /** The colour seed of a mesh with no cluster: the engine's node's `serial`, else its `id`. */
  readonly serial?: number;
  /** A witness's mesh numbers itself here. */
  readonly id: number | string;
  material: HostDiagnosticMaterial | HostDiagnosticMaterial[];
  geometry: HostDiagnosticGeometry;
  userData: Record<string, unknown>;
};

/** The host objects a diagnostic view swaps in, made by the boundary that owns the display graph
 *  and injected into the views; the salt, the colours and the side all arrive computed. */
export type HostDiagnosticFactory = {
  /** Copy of a host geometry with every triangle on its own three vertices. */
  triangleGeometry(source: HostDiagnosticGeometry): HostDiagnosticGeometry;
  /** Writes the per-vertex colours the engine computed onto a host geometry. */
  vertexColors(geometry: HostDiagnosticGeometry, colors: Float32Array): void;
  /** Unshaded surface showing those vertex colours as they are. */
  triangleMaterial(side: number): HostDiagnosticMaterial;
  /** Unshaded surface of one cluster's colour, the hue the core computed from its identifier. */
  clusterMaterial(id: string, side: number): HostDiagnosticMaterial;
};

/** The crossing back: a host resource handed to the library its owner wrote it with. Only a
 *  boundary file (`tests/integration/engine-without-three.test.ts`) may call it, to give the
 *  resource back; reading a contract through another engine shape is `asWholeMesh`'s. */
export const asHostLibrary = <T>(resource: unknown) => resource as T;

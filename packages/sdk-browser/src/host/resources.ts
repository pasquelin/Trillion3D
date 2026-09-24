// Host resources named by shape, never by library: the engine reads what the host created and
// owns, never builds one, so the types below describe only what it reads, and any host object of
// the same shape satisfies them. Boundary files (`tests/integration/engine-without-three.test.ts`)
// alone convert back to a library's types. The 4×4 pose is `MatrixElements` (`matrixElements.ts`).

/** A host texture: the image the host decoded and the sampler state it declared, held by identity
 *  too. Its pixels stay `unknown`: only the boundary that uploads them knows their container. */
export type HostTexture = {
  /** Raised by the host on the objects its sampler reads: what tells a texture from any other
   *  field of a material, whose slots the engine does not enumerate. */
  readonly isTexture?: boolean;
  /** A name unique to the texture. */
  readonly uuid: string;
  /** The host's name for it. */
  readonly name: string;
  /** Bumped by the host on every content change: what an upload compares to skip a re-copy. */
  readonly version: number;
  /** The decoded picture, in the host's own container. */
  readonly image: unknown;
  /** UV set the sampler reads, `KHR_texture_transform`'s `texCoord`. */
  readonly channel: number;
  /** How it repeats across, as the host's constant. */ readonly wrapS: number;
  /** How it repeats up, as the host's constant. */ readonly wrapT: number;
  /** Filter when shown bigger. */ readonly magFilter: number;
  /** Filter when shown smaller. */ readonly minFilter: number;
  /** Sharpness at a slant. */ readonly anisotropy: number;
  /** Whether rows are flipped on upload. */ readonly flipY: boolean;
  /** Whether colour is pre-multiplied by alpha. */ readonly premultiplyAlpha: boolean;
  /** Whether smaller copies are made. */ readonly generateMipmaps: boolean;
  /** How its numbers are read. */ readonly colorSpace: string;
  /** UV transform of the sampler, `KHR_texture_transform` composed into three rows; the host
   *  recomputes it from offset, repeat and rotation when it owns the update. */
  readonly matrix: { readonly elements: number[] };
  /** Whether the host rebuilds `matrix`. */ readonly matrixAutoUpdate: boolean;
  /** Rebuilds `matrix` from offset, repeat and rotation. */ updateMatrix(): void;
  /** What `matrix` is composed from. */ readonly offset: Readonly<{ x: number; y: number }>;
  /** How many times it fits. */ readonly repeat: Readonly<{ x: number; y: number }>;
  /** The pivot of the rotation. */ readonly center: Readonly<{ x: number; y: number }>;
  /** The rotation, in radians. */ readonly rotation: number;
  /** Tells the importer when the host lets go of the texture. */
  addEventListener?(type: 'dispose', listener: () => void): void;
};

/** One vertex attribute of a host geometry, interleaved or not: its layout and its storage. */
export type HostAttribute = {
  /** Raised by the host when the attribute owns its buffer instead of viewing into a shared,
   *  interleaved one. Only the admission gate reads it: the engine's own decode is the same
   *  either way, the autonomous WebGL2 program's binding is not. */
  readonly isBufferAttribute?: boolean;
  /** Numbers per vertex. */ readonly itemSize: number;
  /** How many vertices. */ readonly count: number;
  /** Whether integers read as 0 to 1. */ readonly normalized: boolean;
  /** The storage. */ readonly array: ArrayLike<number> & ArrayBufferView;
  /** Component of one element, de-interleaved and de-normalised by the host. */
  getX(index: number): number;
  /** Second component of one element. */ getY(index: number): number;
  /** Third component of one element. */ getZ(index: number): number;
  /** Fourth component of one element. */ getW(index: number): number;
};

/** The named attributes of one host geometry. Also an identity: the engine keys its GPU buffers,
 *  geometry blocks and position caches on the attribute set a page draws from. */
export type HostAttributes = { [name: string]: HostAttribute };

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

/** A host geometry: its attributes, and the local box the host computed over them. */
export type HostGeometry = {
  /** Its vertex attributes. */ readonly attributes: HostAttributes;
  /** The local box the host computed. */ boundingBox?: HostBox | null;
};

/** A host resource the engine frees when the graph it came from is released: a geometry, a
 *  surface, a texture. The engine never builds one, so freeing it is giving it back. */
export type HostDisposable = {
  /** Frees it. */
  dispose(): void;
};

/** A host material as the engine reads it: the surface parameters every host material shares,
 *  read once at the boundary into the engine's `VisMaterial`; `sideOf` alone reads `side`. */
export type HostMaterial = {
  /** Bumped by the host on every change: what a cached row compares to rebuild its fields. */
  readonly version: number;
  /** Whether it is drawn. */ readonly visible: boolean;
  /** Which faces, as the host's constant. */ readonly side: number;
  /** The host draws a double-sided transparent surface in one pass instead of back then front. */
  readonly forceSinglePass: boolean;
  /** Whether vertex colours tint it. */ readonly vertexColors: boolean;
  /** Whether the display curve applies. */ readonly toneMapped: boolean;
  /** Raster state the host declares with the surface, and the engine's pipelines honour. */
  readonly depthTest: boolean;
  /** Whether it writes depth. */ readonly depthWrite: boolean;
  /** The depth test's comparison. */ readonly depthFunc: number;
  /** Whether it writes colour. */ readonly colorWrite: boolean;
  /** Whether depth is offset. */ readonly polygonOffset: boolean;
  /** Slope part of the offset. */ readonly polygonOffsetFactor: number;
  /** Constant part of the offset. */ readonly polygonOffsetUnits: number;
  /** Whether it blends. */ readonly transparent: boolean;
  /** How opaque it is. */ readonly opacity: number;
  /** Alpha below which pixels drop. */ readonly alphaTest: number;
};

/** What a surface declares: one material, or one per geometry group. */
export type HostMaterials = HostMaterial | HostMaterial[];

/** A host mesh, held by identity: the draw record, the transparent table and the selection sets
 *  name the surface the host placed. Its name is read, and its chain of ancestors when a moved
 *  subtree has to be told from the rest (`../webgpu/pages/render/transform.ts`); nothing else. */
export type HostMesh = {
  /** The host's name for it. */ readonly name: string;
  /** Its parent, when a walk climbs. */ readonly parent?: HostMesh | null;
};

/** A node of the host scene graph, held by identity and by the two fields a walk needs. */
export type HostNode = {
  /** The host's name for it. */ readonly name: string;
  /** Whether it is drawn. */ readonly visible: boolean;
};

/** A host object placed in a display graph: the pose the engine writes on it, the world matrix
 *  the host resolves for it, and the chain a visibility walk climbs. `HostGraphNode`
 *  (`scene/graphNodes.ts`) describes a posed node too, deliberately: this one asks the host to
 *  resolve ONE node with its ancestors, that one a whole subtree; neither stands for the other. */
export type HostPlaced = {
  visible: boolean;
  position: { x: number; y: number; z: number };
  quaternion: { x: number; y: number; z: number; w: number };
  scale: { x: number; y: number; z: number };
  readonly matrixWorld: { readonly elements: ArrayLike<number> };
  readonly parent: HostPlaced | null;
  updateWorldMatrix(ancestors: boolean, descendants: boolean): void;
};

/** A host node the engine walks: the subtree under it, itself first, in the host's own order. */
export type HostTraversable = HostNode & {
  /** Visits itself, then the subtree. */ traverse(visit: (node: HostNode) => void): void;
};

/** A host colour: three linear components, read one by one and written the same way. The engine
 *  never converts here — a colour crosses as the host holds it. */
export type HostColour = {
  /** Red, linear. */ r: number;
  /** Green, linear. */ g: number;
  /** Blue, linear. */ b: number;
};

/** The host display graph an engine draws into: what it holds, how it is walked, and the clear
 *  colour the composition reads. Building it is a host boundary's; writing one, `HostDrawScene`. */
export type HostScene = HostTraversable & {
  /** What fills the image behind. */ readonly background: unknown;
  /** The nodes at its top. */ readonly children: readonly HostNode[];
};

/** A host surface a diagnostic view swaps onto a mesh, then frees: what it hangs arrives through
 *  `HostDiagnosticFactory`, never through an import, so no view names a rendering library. */
export type HostDiagnosticMaterial = HostMaterial &
  HostDisposable & {
    /** A copy of the surface. */ clone(): HostDiagnosticMaterial;
  };
/** A host geometry a diagnostic view may free. */
export type HostDiagnosticGeometry = HostGeometry & HostDisposable;
export type HostDiagnosticMesh = {
  readonly isMesh?: boolean;
  /** Identity the host numbered the mesh with: the colour seed of a mesh with no cluster. */
  readonly id: number;
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

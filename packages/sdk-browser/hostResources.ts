/**
 * Host resources named by shape, never by library.
 *
 * The engine receives materials, textures, geometry attributes, meshes and scene nodes that the
 * host created and still owns: it reads them, it never builds one and never computes with one.
 * Naming them by the rendering library the host happens to use would put that library back inside
 * a number the engine calculates (`docs/SPEC_ENGINE_WITHOUT_THREE.md` R1b), so the contract types
 * below describe only what the engine reads. Any host object of the same shape satisfies them.
 *
 * Boundary files — the witness engines and the host adapters listed by
 * `test/integration/moteur-sans-three.test.ts` — own the conversion back to their library's types;
 * they are the only ones allowed to name it.
 *
 * The 4×4 pose has its own contract, `MatrixElements` of `matrixElements.ts`.
 */

/**
 * A host texture: the image the host decoded and the sampler state it declared. Held by identity
 * too — an atlas layer, a preview rank or a wrap word is addressed by the texture itself. Its
 * pixels stay `unknown`: only the boundary that uploads them knows their container.
 */
export type HostTexture = {
  /** Raised by the host on the objects its sampler reads: what tells a texture from any other
   *  field of a material, whose slots the engine does not enumerate. */
  readonly isTexture?: boolean;
  readonly uuid: string;
  readonly name: string;
  /** Bumped by the host on every content change: what an upload compares to skip a re-copy. */
  readonly version: number;
  readonly image: unknown;
  /** UV set the sampler reads, `KHR_texture_transform`'s `texCoord`. */
  readonly channel: number;
  readonly wrapS: number;
  readonly wrapT: number;
  readonly magFilter: number;
  readonly minFilter: number;
  readonly anisotropy: number;
  readonly flipY: boolean;
  readonly premultiplyAlpha: boolean;
  readonly generateMipmaps: boolean;
  readonly colorSpace: string;
  /** UV transform of the sampler, `KHR_texture_transform` composed into three rows; the host
   *  recomputes it from offset, repeat and rotation when it owns the update. */
  readonly matrix: { readonly elements: number[] };
  readonly matrixAutoUpdate: boolean;
  updateMatrix(): void;
};

/** One vertex attribute of a host geometry, interleaved or not: its layout and its storage. */
export type HostAttribute = {
  /** Raised by the host when the attribute owns its buffer instead of viewing into a shared,
   *  interleaved one. Only the admission gate reads it: the engine's own decode is the same
   *  either way, the autonomous WebGL2 program's binding is not. */
  readonly isBufferAttribute?: boolean;
  readonly itemSize: number;
  readonly count: number;
  readonly normalized: boolean;
  readonly array: ArrayLike<number> & ArrayBufferView;
  /** Component of one element, de-interleaved and de-normalised by the host. */
  getX(index: number): number;
  getY(index: number): number;
  getZ(index: number): number;
  getW(index: number): number;
};

/** The named attributes of one host geometry. Also an identity: the engine keys its GPU buffers,
 *  geometry blocks and position caches on the attribute set a page draws from. */
export type HostAttributes = { [name: string]: HostAttribute };

/** One corner of a local bound, as the host writes it. */
export type HostPoint = { readonly x: number; readonly y: number; readonly z: number };

/** A local or world box of the host, read by its two corners (`hostBoxBounds.ts`). */
export type HostBox = { readonly min: HostPoint; readonly max: HostPoint };

/** A host geometry: its attributes, and the local box the host computed over them. */
export type HostGeometry = {
  readonly attributes: HostAttributes;
  boundingBox?: HostBox | null;
};

/** A host resource the engine frees when the graph it came from is released: a geometry, a
 *  surface, a texture. The engine never builds one, so freeing it is giving it back. */
export type HostDisposable = { dispose(): void };

/**
 * A host material as the engine reads it: the surface parameters shared by every host material,
 * and nothing the host library adds on top. Maps, colours and factors are read once at the
 * boundary into the engine's own `VisMaterial` (`visibilityMaterial.ts`).
 *
 * `side` is the host's face constant; `sideOf` of `materialSide.ts` is the only reader that turns
 * it into the engine's `Side`.
 */
export type HostMaterial = {
  /** Bumped by the host on every change: what a cached row compares to rebuild its fields. */
  readonly version: number;
  readonly visible: boolean;
  readonly side: number;
  /** The host draws a double-sided transparent surface in one pass instead of back then front. */
  readonly forceSinglePass: boolean;
  readonly vertexColors: boolean;
  readonly toneMapped: boolean;
  /** Raster state the host declares with the surface, and the engine's pipelines honour. */
  readonly depthTest: boolean;
  readonly depthWrite: boolean;
  readonly depthFunc: number;
  readonly colorWrite: boolean;
  readonly polygonOffset: boolean;
  readonly polygonOffsetFactor: number;
  readonly polygonOffsetUnits: number;
  readonly transparent: boolean;
  readonly opacity: number;
  readonly alphaTest: number;
};

/** What a surface declares: one material, or one per geometry group. */
export type HostMaterials = HostMaterial | HostMaterial[];

/** A host mesh, held by identity: the draw record, the transparent table and the selection sets
 *  name the surface the host placed. Its name is read, and its chain of ancestors when a moved
 *  subtree has to be told from the rest (`webgpuPagesTransform.ts`); nothing else. */
export type HostMesh = { readonly name: string; readonly parent?: HostMesh | null };

/** A node of the host scene graph, held by identity and by the two fields a walk needs. */
export type HostNode = { readonly name: string; readonly visible: boolean };

/** A host object placed in a display graph: the pose the engine writes on it, the world matrix
 *  the host resolves for it, and the chain a visibility walk climbs. */
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
export type HostTraversable = HostNode & { traverse(visit: (node: HostNode) => void): void };

/** A host colour: three linear components, read one by one and written the same way. The engine
 *  never converts here — a colour crosses as the host holds it. */
export type HostColour = { r: number; g: number; b: number };

/** The host display graph an engine draws into: what it holds, how it is walked, and the clear
 *  colour the composition reads. Building and drawing it belongs to the host boundaries. */
export type HostScene = HostTraversable & {
  readonly background: unknown;
  readonly children: readonly HostNode[];
};

/**
 * WHAT A DIAGNOSTIC VIEW TOUCHES ON THE HOST GRAPH. A diagnostic is not a beauty pass, but the
 * graph it repaints belongs to the host: it swaps a surface and a geometry on a mesh, keeps the
 * beauty pair beside it, and frees what it made. It reads nothing else, and builds nothing — the
 * host objects it hangs arrive through `HostDiagnosticFactory`, handed in by the boundary that
 * owns the graph, never through an import: no view file names a rendering library.
 */
export type HostDiagnosticMaterial = HostMaterial &
  HostDisposable & {
    clone(): HostDiagnosticMaterial;
  };
export type HostDiagnosticGeometry = HostGeometry & HostDisposable;
export type HostDiagnosticMesh = {
  readonly isMesh?: boolean;
  /** Identity the host numbered the mesh with: the colour seed of a mesh with no cluster. */
  readonly id: number;
  material: HostDiagnosticMaterial | HostDiagnosticMaterial[];
  geometry: HostDiagnosticGeometry;
  userData: Record<string, unknown>;
};

/**
 * The host objects a diagnostic view swaps in, made by the boundary that owns the display graph
 * and injected into the views, the way a light placement receives the node its copy aims at.
 * Nothing is decided here: the salt, the per-triangle colours and the side all arrive computed.
 */
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

/**
 * The crossing back: a host resource handed to the library its owner wrote it with. Only a
 * boundary file may call it — a witness engine or a host adapter, both declared by
 * `test/integration/moteur-sans-three.test.ts`, which fails on any other caller — and only to
 * give the resource back to its owner. Reading a contract through another of the engine's own
 * shapes is not this crossing and does not come through here: `asWholeMesh` of
 * `clusterBatchMesh.ts` is that reading for a mesh the engine placed and draws whole.
 */
export const asHostLibrary = <T>(resource: unknown) => resource as T;

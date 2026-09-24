// The world and its families: what a page writes (issue #319). One barrel per family folder.
export * from './world/core/index.ts';
export * from '../../sdk-core/src/world/math/index.ts';
export * from '../../sdk-core/src/world/geometry/index.ts';
export * from '../../sdk-core/src/world/buffer/index.ts';
export * from '../../sdk-core/src/world/object/index.ts';
export * from '../../sdk-core/src/world/material/index.ts';
export * from '../../sdk-core/src/world/light/index.ts';
export * from '../../sdk-core/src/world/camera/index.ts';
export * from '../../sdk-core/src/world/animation/index.ts';
export * from '../../sdk-core/src/world/constants/index.ts';
export * from './world/texture/index.ts';
export * from './world/loader/index.ts';
export * from './world/helper/index.ts';
export * from './world/controls/index.ts';
export * from './world/page/index.ts';
export * from './world/budget/index.ts';
export * from './world/metric/index.ts';
export * from './world/diagnostic/index.ts';
export * from './world/capability/index.ts';
export * from './world/capture/index.ts';
export * from './world/pose/index.ts';
export * from './world/batch/index.ts';

export { EngineProfiler, type TelemetryReport } from './diagnostic/telemetry.ts';

export type {
  AssetScope,
  StablePreview,
  FrameMetrics,
  ClusterManifest,
} from '../../sdk-core/src/index.ts';
export type { BackendDiagnostic, PointOfInterest } from './backend/types.ts';
export type { DiagnosticDetail } from './backend/types.ts';
/** The rows a mirrored mesh is placed through, reachable from the scene a loader records. */
export type { PlacementRows } from './placement/rows.ts';
/** Host resources the engine reads and never builds (`host/resources.ts`): a host declares them
 *  with whatever library it draws with, the contract names only their shape. */
export type {
  HostAttribute,
  HostAttributes,
  HostBox,
  HostColour,
  HostDiagnosticFactory,
  HostDiagnosticGeometry,
  HostDiagnosticMaterial,
  HostDisposable,
  HostGeometry,
  HostMaterial,
  HostMaterials,
  HostMesh,
  HostNode,
  HostPoint,
  HostScene,
  HostTexture,
  HostTraversable,
} from './host/resources.ts';
/** The host scene graph as the engine walks it (`host/scene/graphNodes.ts`): the shapes a source node,
 *  its pose and its rotation are read through. */
export type { HostGraphNode, HostRotation, HostVector } from './host/scene/graphNodes.ts';
/** The engine's own scene graph (`host/graph/`): the classes every `Host*` name above stands for,
 *  the nodes, geometries, surfaces and textures a loaded scene hands back. */
export type {
  GraphArray,
  GraphAttribute,
  GraphElements,
  GraphInterleavedAttribute,
  GraphInterleavedBuffer,
} from './host/graph/attributes.ts';
export type { GraphGeometry } from './host/graph/geometry.ts';
export type { GraphMesh } from './host/graph/mesh.ts';
export type { GraphNode } from './host/graph/node.ts';
export type { GraphNodeKind } from './host/graph/nodeKind.ts';
export type { GraphAngles, GraphRotation } from './host/graph/rotation.ts';
export type { GraphSurface } from './host/graph/surface.ts';
export type { GraphTexture } from './host/graph/texture.ts';
export type { GraphVector } from './host/graph/vector.ts';
export type { HostNodeMatrix, MatrixElements } from './math/matrixElements.ts';
export { gpuPassBlockOf, gpuPassBlockTotals, gpuPassStageOf } from './gpu/core/passBlocks.ts';
export type { GpuPassBlock, GpuPassBlockTotals } from './gpu/core/passBlocks.ts';
export { createDiagnosticChannel } from './diagnostic/channel.ts';
export type {
  DiagnosticChannel,
  DiagnosticChannelOptions,
  DiagnosticObserver,
} from './diagnostic/channel.ts';
export type { SurfaceBuffer, SurfaceCapture } from './scene/surfaceBuffer.ts';
export type { HostDrawCamera } from './camera/world.ts';
export type { HostDrawOutput } from './webgl/core/renderTarget.ts';
export type {
  GeometryPool,
  MemoryBudgets,
  MemoryBudgetsReport,
  PoolClamp,
} from './residency/pools.ts';
export type { TexturePool } from './webgpu/residency/memoryBudgets.ts';
export type { ShadowAtlasDigest } from './gpu/shadow/digest.ts';
export type { PartitionAudit } from './webgpu/core/partitionAudit.ts';
export type { TransparentOcclusionAudit } from './webgpu/transparent/occlusionAudit.ts';
export type { CpuStepSummary } from './stage/cpuProfile.ts';
export type { ArrivalPlan } from './page/integration/host.ts';
export type { DecodedGeometryPage } from './page/decode/geometryPage.ts';
export type {
  TextureLevel,
  TextureLevelReader,
  TextureLevelRequest,
} from './texture/levelReader.ts';
export type { AtlasLanes, LaneCounts, TextureCompression } from './texture/blockFormats.ts';
export type { HostRetentionDelta, StreamPage } from './streaming/types.ts';
export type { BoxTransformLot, MultiplyLot } from './math/batchRuntime.ts';
export type { LightingCapabilities } from '../../sdk-core/src/index.ts';
export { framingFromBounds } from './camera/framing.ts';
export { presentationColorDiagnostic } from './diagnostic/presentationDiagnostic.ts';
export { createGpuPageCache, httpPageSource } from './gpu/page/pages.ts';
export type { ResidentPage } from './gpu/page/pages.ts';
export { createPageStreamer } from './streaming/pages.ts';
export type { ComparisonLayout } from './measurement/comparison.ts';
export { COMPARISON_LIBRARIES, LOD_QUALITY } from '../../sdk-core/src/index.ts';
export { detectCapabilities } from './measurement/capabilities.ts';
export {
  HIERARCHY_ROOT,
  MATRIX_VALUES,
  NORMAL_MATRIX_VALUES,
  POSITION_VALUES,
  QUATERNION_VALUES,
  SPHERE_VALUES,
  boxTransformBatch,
  boxTransformUnionBatch,
  boxUnionBatch,
  composeMatrix4Batch,
  decomposeMatrix4Batch,
  frustumKeepsBoxBatch,
  hierarchyUpdateBatch,
  invertMatrix4Batch,
  linearToSrgbBatch,
  multiplyMatrix4Batch,
  normalMatrix3Batch,
  sphereFromBoundsBatch,
  srgbToLinearBatch,
  transformDirectionsBatch,
  transformPointsBatch,
  transformPointsByMatricesBatch,
} from '../../sdk-core/src/index.ts';

// The camera controllers a session hands out: their contract is public because
// `explorer.controls()` and its four siblings return it (`docs/SDK.md`, "Camera controllers").
export type {
  ChangeListener,
  ControlVector,
  PivotCameraControls,
} from './camera/controls/types.ts';
export type { OrbitCameraControls } from './camera/controls/orbitControls.ts';
export type { FlyCameraControls } from './camera/controls/flyControls.ts';
export type { FirstPersonCameraControls } from './camera/controls/firstPersonControls.ts';
export type { HeadSettings, PersonHead } from './camera/controls/look.ts';
export type { CharacterCameraControls } from './camera/controls/characterControls.ts';
export type {
  CharacterCollision,
  TriangleCollision,
} from '../../sdk-core/src/collision/characterCollision.ts';
export type { Capsule, CapsuleContact, CapsulePush } from '../../sdk-core/src/collision/capsule.ts';
export type { TriangleTree } from '../../sdk-core/src/collision/triangleTree.ts';
export type { TrackballCameraControls } from './camera/controls/trackballControls.ts';
export type { PanZoomCameraControls } from './camera/controls/panZoomControls.ts';

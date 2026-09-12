/** Inventory of web-relevant geometry/LOD libraries. Status describes integration fairness, not marketing coverage. */
export type CompetitorStatus = 'integrated' | 'compatible-not-integrated' | 'incompatible' | 'abandoned' | 'not-comparable';
export interface CompetitorRecord {
 id:string; name:string; status:CompetitorStatus; license:string; maintained:string; scope:string; reason:string; homepage:string;
}
export const COMPARISON_LIBRARIES: readonly CompetitorRecord[] = [
 {id:'three-webgl-reference',name:'Three.js standard',status:'integrated',license:'MIT',maintained:'yes — three.js r174 peer',scope:'Conventional mesh raster, frustum culling, no virtualized geometry',reason:'Reference backend of this SDK',homepage:'https://threejs.org/'},
 {id:'exact-cluster-pages',name:'WebGeometry clusters',status:'integrated',license:'MIT',maintained:'yes — this SDK',scope:'Cluster pages, hierarchy, CPU frustum, optional screen-error cut, residency/eviction',reason:'Primary candidate backend',homepage:'https://github.com'},
 {id:'three-lod',name:'THREE.LOD',status:'integrated',license:'MIT',maintained:'yes — three.js r174',scope:'Distance-based object LOD using generated coarse meshes from the same source',reason:'Same assets; distance thresholds are not pixel-error units',homepage:'https://threejs.org/docs/#api/en/objects/LOD'},
 {id:'meshoptimizer',name:'meshoptimizer',status:'not-comparable',license:'MIT',maintained:'yes',scope:'Meshlet/simplify/compress library, not a scene renderer',reason:'Used by compilers; cannot own camera, materials or a frame protocol',homepage:'https://github.com/zeux/meshoptimizer'},
 {id:'3d-tiles-renderer',name:'3d-tiles-renderer',status:'not-comparable',license:'Apache-2.0',maintained:'yes — NASA-AMMOS',scope:'3D Tiles streaming',reason:'Requires a 3D Tiles tileset; this SDK consumes glTF, not 3D Tiles',homepage:'https://github.com/NASA-AMMOS/3DTilesRendererJS'},
 {id:'cesiumjs',name:'CesiumJS',status:'not-comparable',license:'Apache-2.0',maintained:'yes',scope:'Geospatial 3D Tiles / globe',reason:'Different engine, shaders, camera and asset format; not a fair glTF pair',homepage:'https://cesium.com/platform/cesiumjs/'},
 {id:'babylon-lod',name:'Babylon.js mesh LOD',status:'not-comparable',license:'Apache-2.0',maintained:'yes',scope:'Babylon scene LOD',reason:'Different engine and materials; sharing the same camera/shaders/assets is not possible without a second host stack',homepage:'https://doc.babylonjs.com/'},
 {id:'nanite-webgpu',name:'Scthe/nanite-webgpu',status:'incompatible',license:'MIT',maintained:'research demo (2024)',scope:'Nanite-like meshlet hierarchy + software raster in WebGPU',reason:'Application demo, not a reusable renderer API; different preprocess (METIS/meshoptimizer in-browser); cannot consume Format 1 pages or share the WebGL PBR path',homepage:'https://github.com/Scthe/nanite-webgpu'},
 {id:'three-nanite-example',name:'three.js nanite-style example',status:'not-comparable',license:'MIT',maintained:'three.js examples (WebGPU)',scope:'Example compute rasterizer',reason:'Example, not a package contract; requires WebGPURenderer and its own meshlet build; cannot share this SDK’s WebGL materials',homepage:'https://github.com/mrdoob/three.js'},
 {id:'nexus',name:'VCG Nexus',status:'abandoned',license:'GPL-2.0',maintained:'low — last meaningful web activity stale',scope:'Multiresolution batched meshes',reason:'GPL plus a distinct .nxs format; not a drop-in glTF/Three.js adapter',homepage:'https://github.com/cnr-isti-vclab/nexus'},
 {id:'playcanvas-lod',name:'PlayCanvas mesh LOD',status:'not-comparable',license:'MIT',maintained:'yes',scope:'PlayCanvas engine LOD',reason:'Different engine; no equitable shared-camera protocol with Three.js WebGL2',homepage:'https://github.com/playcanvas/engine'},
];
export function comparisonLibrary(id: string) {
 const row = COMPARISON_LIBRARIES.find(item => item.id === id);
 if (!row) throw new Error(`Unknown comparison library: ${id}`);
 return row;
}

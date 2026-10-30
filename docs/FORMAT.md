# Cache formats — where the code defines them

A compilation writes a cache folder; the SDK reads it. The code is the contract: each section names
a file, its version constants, the Rust that writes it and the TypeScript that reads it. A reader
refuses an unknown version before reading any field.

Paths: `rust/` is `packages/asset-compiler-rust/src/`, `codec/` `packages/page-codec-wasm/src/`,
`core/` `packages/sdk-core/src/`, `browser/` `packages/sdk-browser/src/`.

Each section lives in its own file under [`format/`](format); read only the one you need.

## The version rule
[format/the-version-rule.md](format/the-version-rule.md)

## Layout
[format/layout.md](format/layout.md)

## Pointer
[format/pointer.md](format/pointer.md)

## `clusters.json`
[format/clustersjson.md](format/clustersjson.md): Column files · Cluster DAG

## Pages
[format/pages.md](format/pages.md): On disk · Resident · Voxels

## Textures
[format/textures.md](format/textures.md)

## Prepared scene tables
[format/prepared-scene-tables.md](format/prepared-scene-tables.md): World partition · World HLOD

## `animation-banks.bin`
[format/animation-banksbin.md](format/animation-banksbin.md)

## `sparseVolumes.bin`
[format/sparsevolumesbin.md](format/sparsevolumesbin.md)

## `volumetric-lightmap.bin`
[format/volumetric-lightmapbin.md](format/volumetric-lightmapbin.md)

## `distanceFields.bin`
[format/distancefieldsbin.md](format/distancefieldsbin.md)

## `meshCards.bin`
[format/meshcardsbin.md](format/meshcardsbin.md)

## `rayTracing.bin`
[format/raytracingbin.md](format/raytracingbin.md)

## `lights.json`
[format/lightsjson.md](format/lightsjson.md)

## `physics.json` — cooked colliders
[format/physicsjson-cooked-colliders.md](format/physicsjson-cooked-colliders.md): `bodies` — declared rigid bodies · `softBodies` — cooked soft bodies

## Source glTF
[format/source-gltf.md](format/source-gltf.md)

## Source files
[format/source-files.md](format/source-files.md)

## Deformation in geometry page format 9
[format/deformation-in-geometry-page-format-9.md](format/deformation-in-geometry-page-format-9.md)

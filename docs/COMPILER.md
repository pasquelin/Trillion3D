# The native compiler — `trillion3d-compiler`

One executable prepares a model for the engine. It reads a source through one driver per format —
glTF/GLB, FBX, OBJ, USD/USDZ, Alembic, `.blend`, Maya ASCII, Unity scenes and packages, ZIP and a
dozen image formats ([Input formats](compiler/input-formats.md#input-formats)) — builds the cluster hierarchy, cooks the
textures, colliders and lights, and writes the cache [FORMAT.md](FORMAT.md) describes. A host only
launches it, passes paths and options and listens; no external application is needed.

This page is the user guide. For the internals it is a map: the code is the contract
([Internals](compiler/internals.md#internals)).

Each section lives in its own file under [`compiler/`](compiler); read only the one you need.

## Installing it
[compiler/installing-it.md](compiler/installing-it.md): Platform packages

## Invocation
[compiler/invocation.md](compiler/invocation.md)

## Batch mode
[compiler/batch-mode.md](compiler/batch-mode.md)

## The partition's grids
[compiler/the-partitions-grids.md](compiler/the-partitions-grids.md): Several streaming grids (`partitionGrids`) · Object settings · Animation banks

## HLOD
[compiler/hlod.md](compiler/hlod.md): Assignment and marks · The two forms · Layer settings · Distance fields and chart examples · Refusals and the merge atlas · GPU baking · Simplified layers · Translucent sources

## How a mesh coarsens
[compiler/how-a-mesh-coarsens.md](compiler/how-a-mesh-coarsens.md): Mesh build settings

## Displacement
[compiler/displacement.md](compiler/displacement.md): A material's displacement · Baked displacement

## Voxels far away
[compiler/voxels-far-away.md](compiler/voxels-far-away.md): How voxels are sampled

## Assemblies
[compiler/assemblies.md](compiler/assemblies.md)

## Spline meshes
[compiler/spline-meshes.md](compiler/spline-meshes.md)

## Distance fields
[compiler/distance-fields.md](compiler/distance-fields.md)

## Mesh cards
[compiler/mesh-cards.md](compiler/mesh-cards.md)

## Ray tracing
[compiler/ray-tracing.md](compiler/ray-tracing.md)

## Volumetric lightmap
[compiler/volumetric-lightmap.md](compiler/volumetric-lightmap.md)

## Cancellation
[compiler/cancellation.md](compiler/cancellation.md)

## Events
[compiler/events.md](compiler/events.md)

## The pointer
[compiler/the-pointer.md](compiler/the-pointer.md)

## Reusing a compiled folder
[compiler/reusing-a-compiled-folder.md](compiler/reusing-a-compiled-folder.md)

## Temporal anti-aliasing
[compiler/temporal-anti-aliasing.md](compiler/temporal-anti-aliasing.md)

## A sky material
[compiler/a-sky-material.md](compiler/a-sky-material.md)

## Using it from Node
[compiler/using-it-from-node.md](compiler/using-it-from-node.md)

## Using it from any other host
[compiler/using-it-from-any-other-host.md](compiler/using-it-from-any-other-host.md)

## Exit codes and error codes
[compiler/exit-codes-and-error-codes.md](compiler/exit-codes-and-error-codes.md)

## Input formats
[compiler/input-formats.md](compiler/input-formats.md): glTF buffers, primitive modes and required extensions · Polygon faces · Content Licenses — Independent of Format

## Adding a format
[compiler/adding-a-format.md](compiler/adding-a-format.md)

## Internals
[compiler/internals.md](compiler/internals.md): `volumetric-lightmap.bin` — the baked indirect light (stage `volumetric-lightmap`) · `lights.json` — the lamps of the source file · …

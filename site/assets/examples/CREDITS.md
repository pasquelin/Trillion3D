# Example assets: provenance and credits

Every scene under this folder is compiled by the repository's native compiler from the sources
beside it (`scripts/docs-examples-assets.ts`). Every example built from primitives alone is now
written in code, with `geometry.*`, directly in its `site/examples/*.html` page: it compiles
nothing here and owns no folder under this directory.

The models under `models/` are kept as imported — mesh, textures and, when the author ships one,
the licence file — and never edited. An OBJ model enters a scene as a copy whose `v` lines alone
are scaled to metres and moved into place (`scripts/docs/examples/obj.ts`, `placeObj`), beside an
original setting written as boxes; a glTF model enters as-is, the setting appended to a copy of
its scene file as one more node (`scripts/docs/examples/gltf.ts`, `appendSurfacesGltf`).

| Model          | Folder                | Author        | Source and licence                                                            | Used by                             |
| -------------- | --------------------- | ------------- | ----------------------------------------------------------------------------- | ----------------------------------- |
| Marble Bust 01 | `models/marble-bust/` | Rico Cilliers | [Poly Haven](https://polyhaven.com/a/marble_bust_01), CC0, 1k textures        | `bust`                              |
| Street lamp    | `models/lantern/`     | W. Sitters    | [Elements-3D](https://github.com/pasquelin/Elements-3D), CC BY 3.0 or GPL v2+ | `street-corner` (scale 0.033)       |
| Crate          | `models/crate/`       | W. Sitters    | [Elements-3D](https://github.com/pasquelin/Elements-3D), CC BY 3.0 or GPL v2+ | `crates` (scale 0.01, three copies) |
| Chess set      | `models/chess-set/`   | Web Geometry  | Self-made for these examples, CC0                                             | `a-model-from-obj`                  |

Poly Haven publishes its models under [CC0](https://creativecommons.org/publicdomain/zero/1.0/):
no attribution is required, and the example pages credit the author anyway. W. Sitters' models
come from the asset bank Elements-3D, which redistributes them under their authors' own licences;
they are dual-licensed and this repository uses them under
[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/), whose text ships in each folder as
`CC_attribution_licence.txt`, with the author's `Readme.txt`; each example page that shows one of
them credits the author. Nothing else of that bank was taken: the items without a documented
source, and its `imagerie/` sheets, are not redistributable; the `jeep` by Psionic ships only in
formats the compiler does not read (`.3ds`, `.ms3d`).

`models/chess-set/` holds a chess set on a table written for these examples as one plain OBJ
file and its `.mtl` (released under [CC0](https://creativecommons.org/publicdomain/zero/1.0/)):
turned pieces, an extruded knight's head, a board of 64 squares, a chess clock. It is kept as the
imported file the `a-model-from-obj` example demonstrates, like the models above: its scene copies
it unchanged into `a-model-from-obj/source/` and compiles it as it stands, with nothing added.

The streaming and memory examples reuse `site/assets/gallery/signature-architecture/`, an original
scene of the lessons.

## Scenes modelled in code

Four scenes are modelled in code for their example and released under
[CC0](https://creativecommons.org/publicdomain/zero/1.0/): nothing in them was taken from another
work. Each has a writer under `scripts/docs/examples/`, seeded so the same code writes the same
bytes on every machine, and is rebuilt, source and cache, by
`node scripts/docs-examples-assets.ts <folder>` with the same compiler arguments as the model
scenes above (`full`, 2 threads, 256 MB, `qem-endpoints`, the default `bc7` texture family).

| Folder                   | Writer         | Source                                                                                                      |
| ------------------------ | -------------- | ----------------------------------------------------------------------------------------------------------- |
| `a-model-from-usdz/`     | `chess-set.ts` | `chess-set.usdz`: one USD text layer in centimetres, six turned shapes instanced thirty-two times           |
| `compressed-textures/`   | `courtyard.ts` | `courtyard.gltf` and its five drawn images: glazed tiles, brick, marble, the tiles' and brick's relief      |
| `detail-by-pixel-error/` | `avenue.ts`    | `avenue.gltf`: an avenue of fluted urns and a bronze knot at a tenth of life size                           |
| `ten-thousand-objects/`  | `ring.ts`      | `ring.gltf`: a planet and ten thousand moonlets, four rock shapes in three stones placed ten thousand times |

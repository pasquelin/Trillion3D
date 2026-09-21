# Example assets: provenance and credits

Every scene under this folder is compiled by the repository's native compiler from the sources
beside it (`scripts/docs-examples-assets.mjs`). The procedural scenes — `corner-cube`,
`still-life`, `clay-to-chrome`, `sundial`, `colonnade` — are original, written by
`scripts/docs/examples/scenes.mjs` under the repository licence, with no third-party geometry.

The models under `models/` are kept as imported — mesh, textures and, when the author ships one,
the licence file — and never edited. An OBJ model enters a scene as a copy whose `v` lines alone
are scaled to metres and moved into place (`scripts/docs/examples/obj.mjs`, `placeObj`), beside an
original setting written as boxes; a glTF model enters as-is, the setting appended to a copy of
its scene file as one more node (`scripts/docs/examples/gltf.mjs`, `appendSurfacesGltf`).

| Model          | Folder                | Author        | Source and licence                                                            | Used by                             |
| -------------- | --------------------- | ------------- | ----------------------------------------------------------------------------- | ----------------------------------- |
| Marble Bust 01 | `models/marble-bust/` | Rico Cilliers | [Poly Haven](https://polyhaven.com/a/marble_bust_01), CC0, 1k textures        | `bust`                              |
| Street lamp    | `models/lantern/`     | W. Sitters    | [Elements-3D](https://github.com/pasquelin/Elements-3D), CC BY 3.0 or GPL v2+ | `street-corner` (scale 0.033)       |
| Crate          | `models/crate/`       | W. Sitters    | [Elements-3D](https://github.com/pasquelin/Elements-3D), CC BY 3.0 or GPL v2+ | `crates` (scale 0.01, three copies) |

Poly Haven publishes its models under [CC0](https://creativecommons.org/publicdomain/zero/1.0/):
no attribution is required, and the example pages credit the author anyway. W. Sitters' models
come from the asset bank Elements-3D, which redistributes them under their authors' own licences;
they are dual-licensed and this repository uses them under
[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/), whose text ships in each folder as
`CC_attribution_licence.txt`, with the author's `Readme.txt`; each example page that shows one of
them credits the author. Nothing else of that bank was taken: the items without a documented
source, and its `imagerie/` sheets, are not redistributable; the `jeep` by Psionic ships only in
formats the compiler does not read (`.3ds`, `.ms3d`).

The streamed example reuses `site/assets/gallery/signature-architecture/`, an original scene of the
lessons.

# Example assets: provenance and credits

Every scene under this folder is compiled by the repository's native compiler from the sources
beside it (`scripts/docs-examples-assets.mjs`). The procedural scenes — `corner-cube`,
`still-life`, `clay-to-chrome`, `sundial`, `colonnade` — are original, written by
`scripts/docs/examples/scenes.mjs` under the repository licence, with no third-party geometry.

The three models under `models/` come from the asset bank
[pasquelin/Elements-3D](https://github.com/pasquelin/Elements-3D), which redistributes them under
their authors' own licences. They are kept as imported — mesh, material library, texture and the
author's licence files — and never edited; the scene sources hold copies whose `v` lines alone are
scaled to metres and moved into place (`scripts/docs/examples/obj.mjs`, `placeObj`), beside an
original setting written as boxes.

| Model       | Folder               | Author     | Licence                                      | Used by                             |
| ----------- | -------------------- | ---------- | -------------------------------------------- | ----------------------------------- |
| Helicopter  | `models/helicopter/` | W. Sitters | CC BY 3.0 (or GPL v2+, at the user's choice) | `helipad` (scale 0.06)              |
| Street lamp | `models/lantern/`    | W. Sitters | CC BY 3.0 (or GPL v2+, at the user's choice) | `street-corner` (scale 0.033)       |
| Crate       | `models/crate/`      | W. Sitters | CC BY 3.0 (or GPL v2+, at the user's choice) | `crates` (scale 0.01, three copies) |

W. Sitters' models are dual-licensed; this repository uses them under
[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/), whose text ships in each folder as
`CC_attribution_licence.txt`, with the author's `Readme.txt`. Each example page that shows one of
them credits the author. Nothing else of that bank was taken: the items without a documented
source, and its `imagerie/` sheets, are not redistributable; the `jeep` by Psionic ships only in
formats the compiler does not read (`.3ds`, `.ms3d`).

The streamed example reuses `site/assets/gallery/signature-architecture/`, an original scene of the
lessons.

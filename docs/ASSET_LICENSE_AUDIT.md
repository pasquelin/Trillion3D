# Asset license manifest audit

Run `pnpm audit:assets path/to/licenses.json` before using a corpus. This offline tool checks
asset and evidence SHA-256 hashes and compares **declared** license and usage with the repository's
[content policy](COMPILER.md#content-licenses--independent-of-format). It does not fetch assets,
follow source URLs, send documents, infer a license from a marketplace, or certify legal compliance.
Authenticity, contract interpretation and whether a document actually grants a claimed right remain
human review responsibilities. A hash proves which document was supplied, not what it permits.

## Manifest version 1

Place the manifest at the common root of its assets and local evidence. Paths must stay inside
that root, including through symlinks. Asset IDs and paths must be unique. No assets or evidence
are copied into the repository by this tool; keep purchases and private documents off git.

```json
{
  "version": 1,
  "assets": [
    {
      "id": "tree",
      "path": "assets/tree.glb",
      "sha256": "<64 lowercase hexadecimal characters>",
      "source": "https://example.org/original-listing-or-source-revision",
      "license": "fab-standard",
      "licenseVersion": "exact terms edition from the acquisition record",
      "usage": "embedded-product",
      "evidence": {
        "terms": { "path": "evidence/terms.txt", "sha256": "<sha256>" },
        "acquisition": { "path": "evidence/acquisition.txt", "sha256": "<sha256>" }
      }
    }
  ]
}
```

The example placeholders must be replaced with actual hashes. `terms` identifies the actual
license or ownership evidence; `acquisition` links the asset/source to that license edition or
records original authorship. Retain historical purchase terms; a current listing is not proof
of the license under which an earlier asset was acquired. Unknown license IDs remain unresolved.

| Declaration | Documented checks |
| --- | --- |
| `fab-standard`, `unity-asset-store` | Internal/embedded-product use only; reject standalone redistribution |
| `quixel-epic-engine` | Reject use in Trillion3D |
| `cc-by` | Require `attribution` and `changes` evidence (state explicitly if unchanged) |
| `owned` | Require ownership and authorship evidence, through `terms` and `acquisition` |
| Any other license | Human review required; no inferred commercial allowlist |

`usage` is `internal`, `embedded-product`, `public-demo`, or `raw-distribution`. `public-demo`
means publishing the underlying assets in a demo or public repository, not merely showing pixels
of a finished product; both it and `raw-distribution` require `redistribution` evidence. The tool
checks the presence/integrity of that document, not its legal meaning. A special negotiated license
must use its own license ID and remain under review rather than override a standard-license rule.

## Results and exit status

JSON output separates `technical` integrity findings, `policy` contradictions and `review`
requirements. An empty manifest, malformed declaration or unreadable manifest exits **2**.
A documented prohibition produces `rejected`; an unknown license, missing/corrupt evidence,
invalid source URL or changed asset produces `review-required`. Either exits **1**.
Only all `matches-documented-criteria` results exit **0**; this means the declared criteria and
local hashes matched, never that copyright ownership or legal compliance was established.

The manifest version governs parsing. The report identifies the documented policy being used;
keep the report with the reviewed source revision and re-audit after policy or evidence changes.

## Licence table of every asset

One row per asset the repository uses or tracks. "Declared licence" is what the official source
states, read on 2026-10-05 through the page named in the cell; a page read through a summarising
fetch is marked as such. "Not verified" means the text was not read. Nothing here certifies legal
compliance (see the top of this file). "Fetched" assets live under `.mesure/assets/` (off git, put
there by `node bench/runner/assets/assets.ts` from
[KhronosGroup/glTF-Sample-Assets](https://github.com/KhronosGroup/glTF-Sample-Assets), whose
[README](https://github.com/KhronosGroup/glTF-Sample-Assets/blob/main/README.md) says each model
keeps the licence of its own page); this repository redistributes none of them.

| Asset | Origin | Declared licence (official source read) | Git or fetched | Attribution required | Where it is written | Use |
| --- | --- | --- | --- | --- | --- | --- |
| Sponza | Crytek, via Khronos [`Models/Sponza`](https://github.com/KhronosGroup/glTF-Sample-Assets/blob/main/Models/Sponza/README.md) | "Cryengine Limited License Agreement", © 2016 Crytek ([`LicenseRef-CRYENGINE-Agreement.txt`](https://github.com/KhronosGroup/glTF-Sample-Assets/blob/main/LICENSES/LicenseRef-CRYENGINE-Agreement.txt) points to <https://www.cryengine.com/ce-terms>). Licence text itself not verified. Downloaded outside git, not redistributed by this repository | Fetched | Yes: "Crytek for Everything" (Khronos README) | This table only; to be added to the notices if Sponza is ever shown or shipped | Bench (reference scene), render proofs (`DEFAULT_SCENE`); no site page |
| DamagedHelmet | Khronos [`Models/DamagedHelmet`](https://github.com/KhronosGroup/glTF-Sample-Assets/blob/main/Models/DamagedHelmet/README.md) | Two licences on one model: © 2018 ctxwing, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/legalcode) (rebuild and glTF conversion); © 2016 theblueturtle_, [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/legalcode) (earlier version): **non-commercial** | Fetched | Yes (both) | This table only | Bench (reference scene), proofs; no site page |
| Duck | Khronos [`Models/Duck`](https://github.com/KhronosGroup/glTF-Sample-Assets/blob/main/Models/Duck/README.md) | SCEA Shared Source License 1.0, © 2006 Sony ([`SCEA.txt`](https://github.com/KhronosGroup/glTF-Sample-Assets/blob/main/LICENSES/SCEA.txt)); licence text not verified | Fetched | Yes: "Sony for Everything" | This table only | Bench and proofs (smallest scene) |
| ABeautifulGame | Khronos [`Models/ABeautifulGame`](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/ABeautifulGame), [`Models.md`](https://github.com/KhronosGroup/glTF-Sample-Assets/blob/main/Models/Models.md) | © 2020 ASWF and © 2022 Ed Mackey, CC BY 4.0 | Fetched (whole model); a 200-triangle extract is tracked, see `pawn-body-patch.bin` | Yes | `tests/fixtures/physics/README.md`; this table | Bench, proofs |
| MetalRoughSpheres | Khronos `Models.md` | © 2017 Analytical Graphics, Inc., CC BY 4.0 | Fetched | Yes | This table | Bench, proofs |
| AlphaBlendModeTest | Khronos `Models.md` | © 2018 Analytical Graphics, Inc., CC BY 4.0 | Fetched | Yes | This table | Bench, proofs |
| CesiumMan | Khronos [`Models/CesiumMan`](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/CesiumMan) | © 2017 Cesium, CC BY 4.0; the Cesium logo has a separate notice | Both: fetched for the bench; `site/assets/examples/cesium-man/source/CesiumMan.glb` tracked | Yes | `site/assets/examples/CREDITS.md`; `THIRD_PARTY_NOTICES.md` | Bench, site example |
| FlightHelmet | Khronos `Models.md` | © 2018 Public, CC0 1.0 | Fetched | No | This table | Bench, proofs |
| Lantern (Khronos) | Khronos `Models.md` | © 2017 Microsoft and © 2018 Frank Galligan, CC0 1.0 | Fetched | No | This table | Bench, proofs (not the Sitters street lamp below) |
| AnimatedMorphCube | Khronos `Models.md` | © 2017 Public, CC0 1.0 | Both: fetched; `site/assets/examples/animated-morph-cube/source/AnimatedMorphCube.glb` tracked | No | `site/assets/examples/CREDITS.md` | Bench, site example |
| SciFiHelmet | Khronos [`Models/SciFiHelmet`](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/SciFiHelmet) | © 2017 Public, CC0 1.0 (read through a summarising fetch of its README; absent from the `Models.md` fetch) | Fetched | No | This table | Bench, proofs |
| Suzanne | Khronos [`Models/Suzanne`](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Suzanne) | © 2017 UX3D, CC0 1.0 (same remark) | Fetched | No | This table | Bench, proofs |
| NormalTangentMirrorTest | Khronos [`Models/NormalTangentMirrorTest`](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/NormalTangentMirrorTest) | © 2018 Analytical Graphics, Inc., CC BY 4.0 (same remark) | Fetched | Yes | This table | Bench, proofs |
| TextureCoordinateTest | Khronos [`Models/TextureCoordinateTest`](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/TextureCoordinateTest) | © 2017 Analytical Graphics, Inc., CC0 1.0 (same remark) | Fetched | No | This table | Bench, proofs |
| `pawn-body-patch.bin` | 200 triangles cut from ABeautifulGame (`Pawn_Body_Shared`) | CC BY 4.0, as ABeautifulGame | Git, `tests/fixtures/physics/` | Yes | `tests/fixtures/physics/README.md`; `THIRD_PARTY_NOTICES.md` | Physics cook tests |
| Box (Draco) | Khronos [`Models/Box/glTF-Draco`](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Box/glTF-Draco) | © 2017 Cesium, CC BY 4.0 | Git, `tests/fixtures/formats/gltf/compressed-box/`, unmodified | Yes | Its `LICENSE.txt`; `tests/fixtures/formats/README.md`; `THIRD_PARTY_NOTICES.md` | Format test (Draco) |
| Marble Bust 01 (`marble-bust`) | [Poly Haven](https://polyhaven.com/a/marble_bust_01), Rico Cilliers | CC0 (page read) | Git, three copies: `site/assets/examples/bust/source/`, `.../marble-bust/source/`, `.../models/marble-bust/` | No (credited anyway) | `site/assets/examples/CREDITS.md` | Site examples (`bust`, `see-the-triangles`, `marble-bust-on-its-pedestal`) |
| Street lamp (`lantern`), Crate (`crate`) | W. Sitters, from [Elements-3D](https://github.com/pasquelin/Elements-3D) (a repository of the owner, redistributing them); Elements-3D page not read | CC BY 3.0 or GPL v2+ as stated in `CREDITS.md`; used under CC BY 3.0; licence text kept in `CC_attribution_licence.txt` (not re-read here) | Git, `site/assets/examples/models/{lantern,crate}/` | Yes | Each folder's `CC_attribution_licence.txt` and `Readme.txt`; `CREDITS.md`; example pages | Site examples (`street-corner`, `crates`) |
| Format fixtures | Written in this repository or cut from its own corpus | CC0-1.0 or the repository `LICENSE`, per row | Git, `tests/fixtures/formats/` | No (except Box above) | `tests/fixtures/formats/README.md`, per-folder `LICENSE.txt` | Native compiler tests |
| Scenes modelled in code (9 example scenes) | Writers in `scripts/docs/examples/` | CC0 | Git, `site/assets/examples/*/` | No | `site/assets/examples/CREDITS.md` | Site examples |
| `hall` | Committed as is, written by no script (`COMMITTED_SOURCES`, `scripts/site-caches.ts`) | Repository `LICENSE` (PolyForm Noncommercial 1.0.0), as its glTF `asset.copyright` states: "Original Trillion3D contributors; repository license" | Git, `site/assets/examples/hall/source/` | No | Its `geometry.gltf` (`asset.copyright`) | Site examples (`lights-from-the-scene-file`, `page-materials`, `a-walker-among-balls`) |
| Observatory (`signature-architecture`) | `scripts/docs/observatory/` | Repository `LICENSE`, as its glTF `asset.copyright` states (same words) | Git, `site/assets/gallery/signature-architecture/` | No | Its `source/geometry.gltf` (`asset.copyright`) | Site streaming and memory examples |
| `kinetic-garden` | `scripts/docs/garden-source.ts` | Repository `LICENSE` (PolyForm Noncommercial 1.0.0); no third-party content | Git, `tests/fixtures/scenes/kinetic-garden/` | No | Its `README.md` | Render proofs |
| `openworld-cell` | Extracted from the owner's `Trillion3D-openworld` at `141f97d` | **Licence not found: to be verified.** Its README declares none | Git, `tests/fixtures/openworld-cell/` | Unknown | Its `README.md` (origin only) | Compiler tests |
| Emerald, Whisperwind (corpus scenes cited in `docs/COMPILER.md`, `docs/FORMAT.md`) | Not stated in the repository | Licence not found: to be verified | Not in git (`tests/assets/` is ignored) | Unknown | None | Compiler measurements quoted in docs |

Sponza, DamagedHelmet and Duck carry terms that go beyond a plain attribution (a vendor licence,
a non-commercial part, a shared-source licence). They stay out of git and out of the site until
their texts are read and accepted. Any change that tracks or shows one of them must add its row's
attribution to [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md#assets).

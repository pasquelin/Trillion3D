# Source surface importers — issue #356

This report covers PLY, STL, COLLADA, 3MF, 3DS, KMZ and the bounded IFC4 subset. It describes implemented behavior, not universal support for every feature of these formats. Passing final native gates and raw release timing/RSS measurements are recorded below.

## Routing and identity

Each format enters the existing scene route and produces the existing glTF intermediate tables. PLY/STL/COLLADA/3MF/3DS/IFC use `mesh_source::FilePlugin`; KMZ reuses the existing atomic ZIP extraction/container path and the COLLADA reader. They do not introduce an alternate compiler or runtime mesh format.

Source primitive order and material references are retained. Equal-valued named material/style slots remain distinct. Adjacent primitives may share an output primitive only when their material identity agrees; this does not reorder triangles. Polygons and parametric extrusions have generated triangles, whose deterministic tessellation is distinguished from authored triangle order. Shared geometry instances remain separate nodes; COLLADA, 3MF and IFC reuse mesh definitions when their source geometry/material binding is identical.

Vertex opacity activates a `BLEND` material. When a declared opaque material needs a vertex-opacity variant, its original slot remains and `extras.sourceMaterial` links the variant to it. Such a variant increases output material count intentionally; fixtures without derived variants keep their declared material count.

## Implemented domains and explicit refusals

| Format                   | Implemented domain                                                                                                                                                                                                                                                          | Explicit limitations                                                                                                                                                                                                                                      |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PLY 1.0                  | ASCII, little/big-endian binary; indexed triangle/polygon faces; positions, normals, one UV family, RGB/alpha and material-index extension                                                                                                                                  | Unknown elements/properties; incomplete attributes; rings beyond 4096 corners; invalid/self-intersecting polygon tessellation                                                                                                                             |
| STL                      | ASCII named solids; binary facets; authored/computed normals; VisCAM and Magics colours                                                                                                                                                                                     | No standard source units: numeric coordinates retain the compiler's unit convention; unsupported attribute/header material encodings refused                                                                                                              |
| COLLADA 1.4/1.5 static   | Triangles/polylist/hole-free polygons; position/normal/UV/colour; hierarchy and instances; ordered transforms/matrices; units/up axis; COMMON diffuse/emission/opacity and package-local 2D diffuse images                                                                  | Controllers, animation, cameras/lights, polygon holes, unsupported accessor layouts, nonzero unsupported shading channels, external references                                                                                                            |
| 3MF Core + colour groups | Guarded OPC ZIP; indexed meshes; named base-material identities; per-corner colour groups; components/build instances; transforms and declared units                                                                                                                        | Texture/composite resources, interpolated base-material identities, unhandled required extensions and external component semantics                                                                                                                        |
| 3DS static EDIT3DS       | Bounded little-endian chunks; triangles/material assignments; UVs; smoothing groups; master scale and Z-up conversion                                                                                                                                                       | Keyframes/animation/hierarchy, cameras/lights, texture maps and unsupported appearance channels. Editor-space points are not transformed twice by TRI_LOCAL; the authored modelling frame remains in extras                                               |
| KMZ/KML 2.2              | Guarded ZIP; `doc.kml` Model links to local COLLADA; scale/orientation; absolute WGS84 location; local ENU frame converted to Y-up                                                                                                                                          | Terrain-dependent altitude modes, overlays, network links, ResourceMap remapping, non-model geometry and non-COLLADA Model links                                                                                                                          |
| IFC4 STEP                | `IfcTriangulatedFaceSet` without PnIndex remapping; straight extrusions of rectangles and closed planar polylines; parented local placement; SI length units; representation contexts; surface colour/opacity styles; GlobalId/ExpressId and shared representation identity | CSG/voids, mapped geometry, curves/holes outside the supported extrusion domain, material associations/layers, extra rendering/texture channels, georeferencing map conversions, non-SI length units. This is not a general IFC/BIM or CSG implementation |

## Colour and coordinate conventions

PLY unsigned RGB channels are sRGB-decoded; floating channels are linear. STL colour extensions have no normative colour space, so both supported conventions use documented sRGB decoding. Five-bit channels are divided directly by 31 before conversion, without an intermediate eight-bit quantization. 3MF display colours are sRGB-decoded. COLLADA and IFC surface float colours remain linear. Alpha is never gamma-decoded.

COLLADA retains source node matrices and emits the declared unit/up-axis conversion once. 3MF, 3DS and IFC use a Z-up to Y-up root. Negative instance scales are preserved, with authored local triangles retained. KML locations use WGS84 ellipsoid coordinates and an ENU frame anchored at the first Model. The geographic location and anchor remain in node extras; absent terrain is never fabricated.

## Admission, cancellation and malformed sources

Single-file input admission reserves seven eighths of the supplied budget for decoded data and output. Source-specific count checks precede geometry expansion; `mesh_bounded` cumulatively accounts for retained binary/tables plus incoming vertices before emitting another mesh. This is conservative admission accounting, not a hard process RSS guarantee.

XML parsing disables DTDs and limits node count. Polygon profiles/rings are capped at 4096 corners. Placement/component recursion is capped at 256. IFC STEP admission reserves 48 times the input byte size for decoded attributes; the external parser also bounds nested syntax. IFC references, duplicate IDs and output indices are validated. 3DS chunks cannot escape parent payloads; smoothing work is capped at ten million contributions. KMZ uses existing archive path, symlink, encryption and byte/entry ceilings, with an additional normalized duplicate-path check. 3MF validates every ZIP entry and cumulative decompressed size before reading model parts. Cancellation is checked at source, object and face iteration boundaries.

Unsupported features produce named errors instead of silently removing geometry or inventing material values. The admitted subset is deliberately documented above.

## Committed fixtures and tests

All fixtures below are repository-authored CC0 public-format samples. They are redistributable examples of the published grammars, not downloaded third-party assets.

| Fixture                                    | Expected mesh instances | Triangles across instances | Material/style slots |
| ------------------------------------------ | ----------------------: | -------------------------: | -------------------: |
| `tests/fixtures/formats/ply/scene.ply`     |                       1 |                          2 |                    0 |
| `tests/fixtures/formats/stl/scene.stl`     |                       2 |                          2 |                    0 |
| `tests/fixtures/formats/collada/scene.dae` |                       3 |                          3 |                    2 |
| `tests/fixtures/formats/3mf/scene.3mf`     |                       2 |                          2 |                    2 |
| `tests/fixtures/formats/3ds/scene.3ds`     |                       1 |                          2 |                    2 |
| `tests/fixtures/formats/kmz/scene.kmz`     |                       3 |                          3 |                    2 |
| `tests/fixtures/formats/ifc/scene.ifc`     |                       3 |                         20 |                    2 |

`src/tests/formats/surface_sources.rs` runs these fixtures through the real route/compiler, checks counts and emitted mesh bytes, and verifies unchanged cache identity for direct surface formats. Parser tests inspect emitted binary attributes, material ranks, transforms, alpha, negative scale, units and named refusals. 3DS and KMZ include deterministic fixture generators; 3MF includes its readable model XML.

The shared native reader run passed all 21 tests for these seven adapters (`.worktrees/logs/356-surfaces-native.log`). The broader filter passed 122 tests and failed one unrelated Rhino block CRC test; that failure remains visible rather than being reported as a passing global gate. The full compiler pipeline passed both `surface_sources` tests for all seven formats (`.worktrees/logs/356-surfaces-pipeline.log`, exit 0), including the expected counts and direct-format cache identity. After isolating the legacy JSON feature domain, the shared debug formats run passed 127 tests with 8 ignored fixture generators, including both surface-source pipelines (`.worktrees/logs/356-formats-isolated-json.log`). The final release gates and raw compile-time/peak-RSS measurements follow.

## Final release validation and measurements

The final shared native gate exited 0: 822 unit tests passed, 13 fixture-regeneration tests and the external-Sponza test remained explicitly ignored, and all 17 CLI/integration tests passed. The final changed-files gate also exited 0 with 768 tests passed and no skips. Logs: global `.worktrees/logs/356-validate-native-complete.log` and `356-check-changed-complete.log`. These passing final gates supersede the earlier diagnostic failures described above.

Measured at `20261001T011158Z` sequentially on fresh output caches with the final all-features release CLI, one worker, 64 MiB admission, no simplification and BC7 previews. Filesystem caches were not flushed. These small-fixture smoke measurements do not establish general throughput or a hard RSS ceiling. Monotonic wall time and Linux `os.wait4` child rusage provide the raw counters; binary hashing was streamed before spawning. No build or test job ran concurrently.

The complete commands, UTC/platform, fixture hashes, binary SHA-256 and raw counters are committed in [source-formats-356-timings.json](source-formats-356-timings.json). The larger 14-fixture snapshot is [source-formats-356-final-timings.json](source-formats-356-final-timings.json). Initial debug observations are retained only as diagnostic logs, without a performance comparison across profiles.

| Format  | Wall ms | Peak RSS KiB | Selected triangles | Exit |
| ------- | ------: | -----------: | -----------------: | ---: |
| ply     |    9.05 |        16480 |                  2 |    0 |
| stl     |    8.20 |        16204 |                  2 |    0 |
| collada |   16.18 |        18696 |                  3 |    0 |
| 3mf     |   15.16 |        18980 |                  2 |    0 |
| 3ds     |    8.13 |        16192 |                  2 |    0 |
| kmz     |   15.38 |        21128 |                  3 |    0 |
| ifc     |   17.27 |        23132 |                 20 |    0 |

Binary SHA-256: `82ee39079e17a8cc7737a93cdfdd26c38050b5eb79227e9629e729c1d6ce2057`.

## Dependency provenance

Native handwritten readers follow the published PLY/STL, Khronos COLLADA, 3MF Core/material, Autodesk 3DS and OGC KML grammars. XML uses `roxmltree` 0.20; ZIP uses the repository's existing `zip` dependency and guarded extraction code. IFC syntax uses unmodified `ifc-lite-core` 20.2.0 under MPL-2.0. The unrestricted geometry router was deliberately not added: bounded native geometry conversion keeps identity, cancellation and named refusal behavior reviewable. No third-party example implementation was copied.

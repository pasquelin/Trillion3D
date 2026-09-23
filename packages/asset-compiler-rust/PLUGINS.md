# Adding a Format to the Compiler

The compiler knows no input format. It knows **drivers**: one per format, each in its module, all listed in a static registry. Adding a format means adding a module and a line; removing a format means removing both. Core does not change.

What the driver must produce is always the same: the **intermediate scene**, a glTF 2.0 and its binary, which `compile` alone knows how to read. Images follow the same model, toward RGBA8 or, for high dynamic range formats, toward RGBA linear float.

The policy — which formats are admitted, which are rejected, under what conditions and under what license — is in [`FORMATS.md`](FORMATS.md).
It takes precedence over this document: a driver outside this list will not be merged.

## A Scene Driver

1. A module in `src/plugins/scene/<format>.rs`, named after the format, never after the library reading it. Two formats read by the same library remain two drivers, two names, two versions; shared code goes in a neighboring module, like `ufbx_driver.rs` for FBX and OBJ.
2. `impl Plugin`: `name` (the format in lowercase), `version` (changing it invalidates caches, it names the library and its version), `extensions` (lowercase, without leading dot).
3. `impl ScenePlugin`: `accepts_head` recognizes the format header — `false` for a text format without one —, `prepare` returns `PreparedScene::InPlace` for direct input or `request.converted(directory)` for what the driver wrote into `request.cache`.
4. One line in `scene::PLUGINS`.

A **project** driver — `unity` being the first — additionally claims an entire folder via `project_inputs` and then takes precedence over file drivers found underneath, whose files become its inputs rather than competing sources; two projects for the same folder remain ambiguous.

`prepare` receives all files from the folder claimed by this driver: it decides whether to accept one or several, and rejects with `SOURCE_FORMAT_AMBIGUOUS` when it only wants one.
It checks `request.cancelled` at each bounded work boundary, publishes its progress via `request.progress`, and never writes alongside the source — only under `request.cache`.

Filling glTF tables (nodes, meshes, materials, accessors, images) is shared in `src/import/tables.rs` (`SceneTables`); emitting a primitive from deduplicated vertices is shared in `src/import/primitive.rs` (`Vertices`). A driver building its geometry uses these two modules rather than rewriting its own table filling.

Images do not follow the scene into the cache: they stay where the driver read them. The root where relative image URIs resolve is therefore `scene::image_root(request.source)` — the source folder, or the extracted folder for a container —, and `request.converted` attaches it to the converted scene so the compiler re-reads the same bytes. A driver resolving an image calls this function; it does not write a second version.

## A Container Driver

An archive is not a scene: it is a container for a source. A container is an ordinary scene driver — `zip` being the first — that extracts under `request.cache`, traverses a single root folder, then **routes the extracted folder through the router** and returns what the selected scene driver returns. The router's rules apply as-is: unknown or ambiguous means rejection.

What does not depend on the archive format lives in `scene/archive.rs` — named ceilings (entries and uncompressed bytes), rejection of output outside extraction folder, extraction key, composition with the router. ZIP reading itself is shared in `scene/archive/zip_reader.rs`, used by `zip` and `usdz` (an uncompressed, aligned ZIP). A second container adds its reading module, not a second version of all this.
Protections are non-negotiable: no absolute paths or `..`, no symlinks followed, no encrypted archives opened, and a named rejection — never half an extraction.

## An Image Driver

1. A module in `src/plugins/image/<format>.rs`, same naming rule.
2. `impl Plugin`, then `impl ImageDecoder`: `mime`, `accepts_head` (the format's magic number) and `decode`, which returns `DecodedImage` under the received allocation ceiling.
3. One line in `image::DECODERS`.

An impossible decode returns a report reason — a stable string like `image-decode-failed` — never a compilation error: an unreadable texture lets the engine fall back to its default white.
The decoder never returns an empty image and never panics.

`DecodedImage` has two variants since `image-plugin-2`: `Rgba8`, and `RgbaF32` for high dynamic range formats. **A driver never converts one to the other**: bringing float down to 8-bit requires tone mapping, i.e., loss that the source did not have. The consumer decides via a `match` and a named reason — `image-float-unsupported` for previews, which are RGBA8 sRGB. A float driver checks the allocation ceiling at **sixteen bytes per pixel** before allocating, via `float_budget`, and the rejection carries its own format name.

## What to Provide With It

- **A minimal golden fixture**: the smallest file of the format owned or redistributable, under `../../tests/fixtures/formats/`, with its `expected.json`, compiled by the shared harness (`src/tests/golden.rs`) — never by a custom harness. `GoldenRun::prepared_dir` finds a driver's prepared directory and `scene_digest` extracts the comparable triplet for `expected.json`; use these rather than re-reading produced files yourself.
- **One test per driver behavior**: what it recognizes, what it rejects, what it reports. Router and registry tests already exist: do not duplicate them per format. To read a decode result, use `rgba8()` or `rgba_f32()` from `src/plugins/tests.rs` — never an irrefutable `let` on a `DecodedImage` variant: the contract has two outputs, and a test assuming one must state so via a call that panics on the other.
- **Provenance**: where the spec comes from, which library, which license. Place it in the module header and commit message.

## Forbidden

- Reusing code or an editor SDK, even if available: reader written from public specification or permissive library whose license is respected and preserved.
- Bypassing encryption, protection or license check of a format.
- Re-encoding a lossy source, modifying or writing alongside original files.
- Placing anything format-specific in `main.rs`, `cli_batch.rs` or `compiler_args.rs`: the CLI is thin, naming no format.
- Adding an empty driver "for later": a format without a reader has no module.

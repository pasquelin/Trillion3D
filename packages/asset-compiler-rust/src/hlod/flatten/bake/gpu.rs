//! The atlases baked on the GPU, on the compile's one device (`flatten/gpu.rs`): each job packs and
//! uploads its own scene while others run, only its submissions and read-backs take the device's
//! turn. A bake is one compute pass over the texels the CPU rasterized, each read from the
//! sources by the one program of `shade.wgsl` — each texture filtered over a footprint, wrapped as
//! its sampler wraps it —, a translucent source seen through or not (`../seen.rs`):
//! - an approximated shell's atlas, its interior texels read through the views of the sources
//!   (`capture.wgsl`, `../capture.rs`); the CPU rasterizes the shell in atlas space first — which
//!   texel a triangle covers, the gutter around each chart (`uv::raster`) — and fills the holes
//!   and the gutter after (`atlas`);
//! - a merged entry's tile, each covered texel read from the triangle that covers it
//!   (`tile.wgsl`, `tiles.rs`, `merge/tile.rs`), a translucent one over what the ray from it
//!   inward meets among the merged mesh.
//!
//! What decides a texel's place stays exact and cheap, the reading of the sources, the cost of the
//! bake, moves to the GPU. A library's texture chains are uploaded once and held until it drops
//! (`chains`); every buffer of a bake is destroyed when it ends.
//!
//! A baked texel's bytes follow the GPU's arithmetic: two GPUs may part by a unit in a byte, one
//! GPU always bakes the same bytes.
use super::capture::Views;
use super::sources::{Library, Sources};
use super::{Flat, Maps};
use crate::hlod::flatten::gpu::{counted, device, held_bytes, Passes, Program, Source};
use trillion3d_page_codec::proxy::bvh::Node;
mod chains;
mod frames;
mod layout;
mod records;
mod run;
mod scene;
mod surfaces;
mod tiles;
pub(crate) use chains::Pages;
pub(crate) use layout::STORAGE_BUFFERS;
pub(crate) use records::SOURCE_WORD_BYTES;
pub(crate) use tiles::{Laid, Tile, TRIANGLE_WORD_BYTES};

/// The passes of the program, in the order of its source: a shell's `capture`, a merged entry's
/// `tile`.
const PASSES: &[&str] = &["capture", "tile"];

/// The place of the pass `name` among `PASSES`; a name the program does not list stops the build.
const fn place(name: &str) -> usize {
    let (wanted, mut at) = (name.as_bytes(), 0);
    while at < PASSES.len() {
        let listed = PASSES[at].as_bytes();
        let mut k = 0;
        while k < wanted.len() && k < listed.len() && wanted[k] == listed[k] {
            k += 1;
        }
        if k == wanted.len() && k == listed.len() {
            return at;
        }
        at += 1;
    }
    panic!("a pass the bake's program does not list")
}

const CAPTURE: usize = place("capture");
const TILE: usize = place("tile");

/// The bake's program: the prelude and its shaders, its bindings (`layout::bindings`), its two
/// passes.
fn source() -> Source {
    let wgsl = [
        layout::prelude().as_str(),
        include_str!("gpu/scene.wgsl"),
        include_str!("gpu/capture.wgsl"),
        include_str!("gpu/tile.wgsl"),
        include_str!("gpu/walk.wgsl"),
        include_str!("gpu/shade.wgsl"),
        include_str!("gpu/texture.wgsl"),
    ]
    .concat();
    Source {
        label: "HLOD bake",
        wgsl,
        bindings: layout::bindings(),
        passes: PASSES,
    }
}

/// The texels `rows` of the shell `flat` — per row, each texel's column and row (`x | y << 16`),
/// its shell triangle and its second and third weights' bits — read through `views` of `sources`,
/// a translucent source seen through when `seen_through` (`super::seen`), their rays walking the
/// tree `nodes` over them, the chains `library` holds read from its pages, each texel's result
/// handed to `write` with its sample as its batch returns: its base word (sRGB colour,
/// roughness), normal word (tangent-space normal, metallic), a word holding whether a view sees it
/// in its first bit, its specular byte in its second byte and its emission's blue at half
/// precision in its upper half, and a word of its emission's red and green at half precision.
/// Stops when the library's cancel token is raised.
pub(super) fn bake(
    flat: &Flat,
    (sources, library): (&Sources, &Library),
    (nodes, views, seen_through): (&[Node], &Views, bool),
    rows: &[Vec<[u32; 4]>],
    write: &mut dyn FnMut([u32; 4], [u32; 4]),
) -> crate::Result<()> {
    if rows.iter().all(Vec::is_empty) {
        return Ok(());
    }
    let device = device()?;
    let passes: &Passes = device.passes(Program::Bake, source)?;
    let pages = library.pages()?;
    let scene = scene::Scene::captured(flat, sources, (nodes, views, seen_through))?;
    let mut land = |sample: [u32; 4], result: &[u32; 4]| write(sample, *result);
    let cancelled = &library.cancelled;
    run::run::<[u32; 4]>(
        device,
        (passes, CAPTURE),
        (scene, &pages),
        rows,
        cancelled,
        &mut land,
    )
}

/// The bytes a bake of `texels` texels over `triangles` source triangles holds on the device,
/// counted (`counted`): its scene's words, `words` bytes of each triangle, twice — the queue's
/// staging and the buffer they go to (`run`) —, and its batches, `O` each result.
fn device_bytes<O>(words: usize, (triangles, texels): (usize, usize)) -> usize {
    let scene = triangles.saturating_mul(2 * words);
    counted(scene.saturating_add(held_bytes(run::sample_bytes::<O>(), texels)))
}

/// What a shell's or a simplified layer's capture bake holds on the device (`device_bytes`).
pub(crate) fn captured_device_bytes(triangles: usize, texels: usize) -> usize {
    device_bytes::<[u32; 4]>(SOURCE_WORD_BYTES, (triangles, texels))
}

/// What a merged entry's tile bake holds on the device (`device_bytes`).
pub(crate) fn tiled_device_bytes(triangles: usize, texels: usize) -> usize {
    device_bytes::<Tile>(TRIANGLE_WORD_BYTES, (triangles, texels))
}

/// The texels `rows` of a merged entry's tile — per texel, its column and row (`x | y << 16`), its
/// triangle's slot among `sources` and its second and third weights' bits —, each read from the
/// triangle that covers it: the triangles `laid` places in the entry's image, the tree `nodes`
/// over `sources` walked by the rays of the texels of an entry seen through (`behind`), the chains
/// `library` holds read from its pages, `maps` the images baked. Each texel's words (`Tile`)
/// handed to `write` with its sample as its batch returns. Stops when the library's cancel token
/// is raised.
pub(crate) fn bake_tile(
    (sources, nodes): (&Sources, &[Node]),
    laid: &[Laid],
    (library, maps, behind): (&Library, Maps, bool),
    rows: &[Vec<[u32; 4]>],
    write: &mut dyn FnMut([u32; 4], &Tile),
) -> crate::Result<()> {
    if rows.iter().all(Vec::is_empty) {
        return Ok(());
    }
    let device = device()?;
    let passes: &Passes = device.passes(Program::Bake, source)?;
    let pages = library.pages()?;
    let scene = scene::Scene::tiled((sources, nodes), laid, (maps, behind))?;
    let cancelled = &library.cancelled;
    run::run(
        device,
        (passes, TILE),
        (scene, &pages),
        rows,
        cancelled,
        write,
    )
}

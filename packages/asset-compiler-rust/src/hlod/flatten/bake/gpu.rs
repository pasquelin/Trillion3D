//! The approximated shells' atlases baked on the GPU, on the compile's one device
//! (`flatten/gpu.rs`): each job packs and uploads its own scene while others run, only its
//! submissions and read-backs take the device's turn. A bake is one compute pass over the shell's
//! interior texels, reading each through the views of the sources (`capture.wgsl`,
//! `../capture.rs`), a translucent source seen through or not (`../seen.rs`). The CPU rasterizes
//! the shell in atlas space first — which texel a triangle covers, the gutter around each chart
//! (`uv::raster`) — and fills the holes and the gutter after (`atlas`): what decides a texel's
//! place stays exact and cheap, the reading of the sources, the cost of the bake, moves to the
//! GPU. A library's texture chains are uploaded once and held until it drops (`chains`); every
//! buffer of a bake is destroyed when it ends.
//!
//! A baked texel's bytes follow the GPU's arithmetic: two GPUs may part by a unit in a byte, one
//! GPU always bakes the same bytes.
use super::capture::Views;
use super::sources::{Library, Sources};
use super::Flat;
use crate::hlod::flatten::gpu::{device, Passes, Program, Source};
use trillion3d_page_codec::proxy::bvh::Node;
mod chains;
mod frames;
mod layout;
mod run;
mod scene;
pub(crate) use chains::Pages;
pub(crate) use layout::STORAGE_BUFFERS;
pub(crate) use run::SAMPLE_BYTES;

/// The bake's program: the prelude and its shaders, its bindings (`layout::bindings`), its one
/// pass.
fn source() -> Source {
    let wgsl = [
        layout::prelude().as_str(),
        include_str!("gpu/scene.wgsl"),
        include_str!("gpu/capture.wgsl"),
        include_str!("gpu/walk.wgsl"),
        include_str!("gpu/shade.wgsl"),
    ]
    .concat();
    Source {
        label: "HLOD bake",
        wgsl,
        bindings: layout::bindings(),
        passes: &["capture"],
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
    let scene = scene::Scene::new(flat, sources, (nodes, views, seen_through))?;
    run::run(
        device,
        passes,
        (scene, &pages),
        rows,
        &library.cancelled,
        write,
    )
}

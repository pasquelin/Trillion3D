//! The sources' flattened materials transferred onto the simplified mesh's atlas (`transferred`),
//! as the method maps them:
//!
//! 1. a tree over the sources' triangles (`kdop`); the mesh's triangles laid out at their atlas
//!    coordinates on the grid, the transfer's texel grid, padded two texels, and on the fine grid,
//!    four fine texels a side to a texel of the grid, padded one fine texel (`raster`);
//! 2. each fine texel paired with a point of the sources by rays along the mesh's transfer normals
//!    (`rays`), and each texel of the grid gathered from its sixteen fine texels (`row`, `read`,
//!    `gather`): its base colour, keeping their mean luminance, a fine texel no source answers the
//!    layer's unresolved colour; its coverage, the base image's alpha, none where no source
//!    answers; its normal, the mean of the world normals read, written unnormalised in the frame
//!    the mesh's own tangents give (`tangents`); its specular, roughness and metallic, and its
//!    emission, none where no source answers;
//! 3. the texels none of whose fine texels a triangle maps to filled ring by ring from the valid
//!    ones around them (`dilate`), or, without dilation, opaque black, the frame's own normal and
//!    zero coverage, specular, roughness, metallic and emission;
//! 4. each image down sampled from the grid to its own side where the two differ, the normal made
//!    unit again (`resample`);
//! 5. the bytes (`values`): base colour, roughness, metallic, specular and emission in sRGB, the
//!    coverage in the base image's alpha, the normal quantized (`colour`); and the atlas's
//!    occupancy, at the base image's side: sampled where a triangle of the grid holds a texel's
//!    centre — any texel of the grid its own overlaps when the sides differ —, empty elsewhere.
//!
//! Every step runs on independent texels, rows or bands in parallel, each value what the method's
//! own order of the same steps leaves in it.
mod colour;
mod dilate;
mod gather;
mod plane;
mod raster;
mod rays;
mod read;
mod resample;
mod row;
mod values;
mod vertex;
use super::kdop::{Tree, Walk};
use super::proxy::Proxy;
use super::sources::Sources;
use crate::hlod::flatten::bake::Maps;
use crate::hlod::flatten::merge::Image;
use crate::hlod::flatten::uv::raster::{EMPTY, SAMPLED};
use crate::hlod::flatten::Sides;
use crate::hlod::options::HlodTransferRays;
use crate::plugins::scene::cancel::check;
use colour::linear;
use raster::{Raster, Texel};
use rayon::prelude::*;
use rays::Rays;
use row::{Reader, Row};
use std::sync::atomic::AtomicBool;
use values::Values;
pub(in crate::hlod::flatten::simplify) use vertex::vertex_colours;

/// The grid's padding, in texels; the fine grid's, in fine texels; and the fine texels a texel of
/// the grid holds.
const PADDING: i32 = 2;
const FINE_PADDING: i32 = 1;
const FINE_SAMPLES: usize = 16;

/// One flattened source material: base colour (sRGB bytes) — its alpha the coverage where the
/// layer bakes one —, the normal map where the layer bakes one — written in the frame the engine
/// rebuilds from the material's coordinates (`merge/tile/frame.rs`) —, the metal-roughness map
/// where it bakes one (specular in R, roughness in G, metallic in B, linear bytes, glTF's layout),
/// the emission map where it bakes one (sRGB bytes held over the strength); each its own size,
/// one texel when it holds one value.
pub(super) struct Flattened {
    pub base: Image,
    pub normal: Option<Image>,
    pub metal_rough: Option<Image>,
    pub emission: Option<Image>,
    pub strength: f32,
}

/// The simplified mesh's frames, in our frame, one of each per vertex of the mesh: its normal, and
/// its tangent with its bitangent's sign (`tangents`).
#[derive(Clone, Copy)]
pub(super) struct Frames<'a> {
    pub normals: &'a [[f32; 3]],
    pub tangents: &'a [[f32; 4]],
}

/// How the transfer runs: the grid's side (the largest of the atlas's sides, 64 at least), the
/// atlas's sides, how far a ray reaches (centimetres), which hit a texel keeps, the base colour of
/// a texel no source answers (sRGB bytes, opaque), the maps the layer bakes, whether the texels
/// no triangle maps to are dilated into, and the mesh's frames the normal map is written in.
pub(super) struct Transfer<'a> {
    pub grid: usize,
    pub sides: Sides,
    pub reach: f64,
    pub rays: HlodTransferRays,
    pub unresolved: [u8; 3],
    pub maps: Maps,
    pub dilate: bool,
    pub frames: Frames<'a>,
}

/// What the transfer made, each image at its own side, RGBA8 row by row: base colour (sRGB) — its
/// alpha the coverage where the maps bake one, else 255 —, the normal map where the maps bake it,
/// the metal-roughness map where they bake one (`[specular, roughness, metallic, 255]`, a channel
/// not baked zero or its constant), the emission map where they bake one, and per texel of the
/// base image its occupancy (`SAMPLED`, `EMPTY`).
pub(super) struct Transferred {
    pub base: Vec<u8>,
    pub normal: Option<Vec<u8>>,
    pub metal_rough: Option<Vec<u8>>,
    pub emission: Option<Vec<u8>>,
    pub occupancy: Vec<u32>,
}

/// The occupancy of an atlas `side` texels square over a grid `grid` texels square, `texels` the
/// grid's (module doc).
fn occupancy(texels: &[Texel], grid: usize, side: usize) -> Vec<u32> {
    let span = |c: usize| c * grid / side..((c + 1) * grid).div_ceil(side);
    (0..side * side)
        .into_par_iter()
        .map(|at| {
            let (x, y) = (at % side, at / side);
            let covered = span(y).any(|j| span(x).any(|i| texels[j * grid + i].inside()));
            if covered {
                SAMPLED
            } else {
                EMPTY
            }
        })
        .collect()
}

/// The sources' flattened materials `flattened` transferred onto `proxy`'s atlas as `transfer`
/// says (module doc), `sources` the sources' triangles, each reading its entry of `flattened`;
/// `Err` when `cancelled` is raised between the steps.
pub(super) fn transferred(
    proxy: &Proxy,
    sources: &Sources,
    flattened: &[Flattened],
    transfer: &Transfer,
    cancelled: &AtomicBool,
) -> crate::Result<Transferred> {
    let tree = Tree::over(sources.triangles.len(), |t| sources.corners(t));
    check(cancelled)?;
    let grid = transfer.grid;
    let coarse = Raster::of(proxy, grid, (PADDING, 1));
    let texels = coarse.all();
    let fine = Raster::of(proxy, grid, (FINE_PADDING, FINE_SAMPLES));
    let normals = match proxy.transfer.is_empty() {
        true => &proxy.normals,
        false => &proxy.transfer,
    };
    let [r, g, b] = transfer.unresolved;
    let reader = Reader {
        rays: Rays {
            proxy,
            normals,
            sources,
            tree: &tree,
            reach: transfer.reach as f32,
            rays: transfer.rays,
        },
        flattened,
        fine: &fine,
        texels: &texels,
        side: grid,
        maps: transfer.maps,
        unresolved: linear([r, g, b, 255]),
        frames: transfer.frames,
    };
    check(cancelled)?;
    let rows: Vec<Row> = (0..grid)
        .into_par_iter()
        .map_init(Walk::default, |walk, y| reader.row(y, walk))
        .collect();
    check(cancelled)?;
    let mut values = Values::of(rows, transfer.maps);
    match transfer.dilate {
        true => values.dilated(grid, cancelled)?,
        false => values.defaulted(),
    }
    values.downsampled(grid, &transfer.sides);
    Ok(Transferred {
        base: values.base_bytes(),
        normal: values.normal_bytes(),
        metal_rough: values.metal_rough_bytes(transfer.maps),
        emission: values.emission_bytes(),
        occupancy: occupancy(&texels, grid, transfer.sides.base),
    })
}

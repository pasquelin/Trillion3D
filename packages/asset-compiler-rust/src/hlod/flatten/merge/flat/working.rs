//! The bytes a merged actor holds while it is made, as the process holds them: stage by stage, each
//! the bytes alive together at its height — an actor is as large as its largest stage, never the
//! sum of them. What the GPU holds is counted only where the process's footprint holds it
//! (`gpu::counted`): the bake's scene twice more, the queue's staging and its buffer, and its
//! batches, in the first stage; the scene's words once, where the process packs them, in every
//! case.
//!
//! Its materials merged (`Flattened`), per stage, `M` the parts placed — a placed copy of every
//! source's cut (`mesh_bytes`) —, `F` the flat mesh and `N` the atlas's texels:
//! 1. an entry baked (`tile::baked`): `M`, what lies behind translucent parts where one is seen
//!    through, and per triangle of the entry's mesh its traced copy, its scene's words until they
//!    go up and the coordinates it is laid at; per texel the atlas's images and the entry's own,
//!    the emission as floats and the texels the entry covers; and what the bake holds on the
//!    device, where the footprint counts it;
//! 2. an entry placed in the atlas (`merged_flat`): `M`, what lies behind, and per texel the two
//!    sets of images and the larger of the dilation and the resize's filtered rows;
//! 3. the atlas finished: `M`, what lies behind, `F` and per texel the atlas's images, the
//!    dilation and the occupancy;
//! 4. the mesh given its DAG (`builds::actor`): `F`, the DAG's build and the atlas's images;
//! 5. the images cooked side by side (`publish::images`): the DAG made, and each image's cook.
//!
//! The merge of the sources (their covers beside the parts, twice `M` at most) stands under the
//! first stage's. A mesh that keeps its materials holds its parts and the sections made of them,
//! then the DAG of each section beside the sections.
use crate::compiler::primitive::cost::dag_bytes;
use crate::hlod::flatten::bake::gpu::{tiled_device_bytes, Laid, TRIANGLE_WORD_BYTES};
use crate::hlod::flatten::bake::Maps;
use crate::hlod::flatten::merge::mesh_bytes;
use crate::hlod::flatten::uv::raster::INFILL_HOLE_BYTES;
use crate::texture::admission::cook_bytes;
use crate::trace::surface::mesh::Corners;
use std::mem::size_of;
use trillion3d_page_codec::proxy::{bvh::Node, PROXY_LEAF_TRIANGLES};

/// How a merged actor's materials are flattened, as its bytes follow it: the atlas's side, the
/// block families its images are cooked for, the maps it bakes beside the base colour, and
/// whether a translucent part is read over what lies behind it (`tile::Behind`).
#[derive(Clone, Copy)]
pub(in crate::hlod) struct Flattened {
    pub side: usize,
    pub families: usize,
    pub maps: Maps,
    pub behind: bool,
}

/// The bytes a triangle holds as a traced copy: its corners placed (nine floats), its material's
/// rank and its attributes (`trace::surface::mesh::Corners`).
const TRACED_TRIANGLE_BYTES: usize = 9 * size_of::<f32>() + size_of::<u32>() + size_of::<Corners>();

/// The bytes a triangle holds of what lies behind a merged mesh's translucent parts: its traced
/// copy, its share of the tree over it — a node over `PROXY_LEAF_TRIANGLES / 2` triangles at most,
/// the room its builder makes — and its slot in the tree's leaf order (`tile::Behind`).
const BEHIND_TRIANGLE_BYTES: usize =
    TRACED_TRIANGLE_BYTES + size_of::<Node>() * 2 / PROXY_LEAF_TRIANGLES + size_of::<usize>();

/// The bytes a triangle holds while its entry is baked on its mesh: the coordinates laid for the
/// mesh and the entry's copy of them turned as its parts mirror it, its place in the entry's image
/// and the steps of its footprint (`tile::covered`).
const LAID_TRIANGLE_BYTES: usize =
    2 * size_of::<[[f64; 2]; 3]>() + size_of::<Laid>() + size_of::<[[f64; 2]; 2]>();

/// The bytes a texel of an image holds, RGBA8.
const IMAGE_TEXEL_BYTES: usize = size_of::<[u8; 4]>();

/// The bytes a vertex of the flat mesh holds: its position, its normal and its coordinates.
const FLAT_VERTEX_BYTES: usize = (3 + 3 + 2) * size_of::<f32>();

/// The bytes the resize of an image holds per texel of it at most: its rows filtered along `x`, in
/// floats (`resize::resized`).
const RESIZED_TEXEL_BYTES: usize = size_of::<[f64; 4]>();

/// The bytes a merged actor holds while it is made from the cut `pieces` — their vertices and
/// corners, each placed copy counted (`cut_counts`) —, its materials merged as `flattened` says,
/// or kept (module doc).
pub(in crate::hlod) fn working_bytes(
    pieces: (usize, usize),
    flattened: Option<Flattened>,
) -> usize {
    let (vertices, corners) = pieces;
    let triangles = corners / 3;
    let parts = mesh_bytes(vertices, corners);
    let dag = dag_bytes(triangles, vertices).unwrap_or(usize::MAX);
    let Some(Flattened {
        side,
        families,
        maps,
        behind,
    }) = flattened
    else {
        return parts.saturating_mul(2).max(parts.saturating_add(dag));
    };
    let held = |terms: &[usize]| terms.iter().fold(0, |sum: usize, &t| sum.saturating_add(t));
    let each = |bytes: usize, count: usize| bytes.saturating_mul(count);
    let (texels, images) = (side.saturating_mul(side), maps.images());
    let lying = if behind {
        each(BEHIND_TRIANGLE_BYTES, triangles)
    } else {
        0
    };
    let emitted = if maps.emissive {
        size_of::<[f32; 3]>()
    } else {
        0
    };
    // The atlas's images, and an entry's own beside them.
    let both = 2 * IMAGE_TEXEL_BYTES * images;
    let flat = held(&[
        each(FLAT_VERTEX_BYTES, vertices),
        each(size_of::<[u32; 3]>(), triangles),
    ]);
    let baking = held(&[
        parts,
        lying,
        each(
            TRACED_TRIANGLE_BYTES + TRIANGLE_WORD_BYTES + LAID_TRIANGLE_BYTES,
            triangles,
        ),
        each(both + emitted + size_of::<[u32; 4]>(), texels),
        tiled_device_bytes(triangles, texels),
    ]);
    let placing = held(&[
        parts,
        lying,
        each(both + INFILL_HOLE_BYTES.max(RESIZED_TEXEL_BYTES), texels),
    ]);
    let finishing = held(&[
        parts,
        lying,
        flat,
        each(
            IMAGE_TEXEL_BYTES * images + INFILL_HOLE_BYTES + size_of::<u32>(),
            texels,
        ),
    ]);
    // Its images are the atlas's at their own sides, the largest at most.
    let building = held(&[flat, dag, each(IMAGE_TEXEL_BYTES * images, texels)]);
    // The DAG made: its vertices and, about as many, those its solves place.
    let cooking = held(&[
        each(2 * FLAT_VERTEX_BYTES, vertices),
        each(cook_bytes(side as u32, families), images),
    ]);
    [baking, placing, finishing, building, cooking]
        .into_iter()
        .max()
        .unwrap_or(0)
}

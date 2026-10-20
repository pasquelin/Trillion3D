//! The HLOD actors' meshes and flattened materials above HLOD 0 (`world.rs` builds their DAGs):
//! HLOD 1, 2 and 3 approximate their sources — at HLOD 1 the objects of an HLOD 0 cell, above it
//! the actors of the layer below — (`approximate.rs`); each mesh is given unique texture
//! coordinates (`unwrap.rs`, `pack.rs`) and the materials of the objects under it read onto it
//! (`bake::project`): every detail under a pixel there — a window's mullions, a ledge — lives in
//! the texture. A proxy layer remeshes them instead (`proxy_lod`), its shell dressed the same way
//! (`baked`); a merged layer merges its sources' own meshes (`mesh_merge`).
//!
//! Each layer's settings follow the distance its actors are first seen from: its deviation is
//! chosen at one pixel there, so the simplification strays at most a pixel from the closed solid;
//! its accuracy, the voxel, is sized from that distance as the proxy layer's voxel is, never finer
//! than the grid the solid is sampled on (`layer_settings`). Every layer takes the one atlas side
//! its settings name, whatever its sources' draw distances. An actor's cell doubles with each
//! layer, so its texel does too: the pixel at the distance each layer is seen from.
//! The unique meshes, the approximated and baked layers and their bounds live in `layers`.
mod appearance;
mod approximate;
mod bake;
mod first_seen;
mod grid_key;
mod heap;
mod marching;
pub(super) mod mesh_merge;
mod morphology;
mod pack;
mod proxy_lod;
pub(crate) mod publish;
mod quadric;
mod raster;
mod simplify;
pub(crate) mod sources;
pub(crate) mod tree;
mod unwrap;
mod winding;

use crate::{HlodBuilder, HlodLayer};
pub(crate) use appearance::tone_gap;
pub(crate) use approximate::{step, Mesh, Placed, StageMs, Stages, STAGE_COUNT};
pub(crate) use bake::{Atlas, Flat};
pub(crate) use sources::{Library, Piece};
mod layers;
use layers::{approximated, baked, bounds_of, unique};

/// The reference view every layer's pixel is measured in: 1920 texels wide, 1080 high, half angle
/// 45°, a full-HD screen.
const SCREEN: (f64, f64) = (1920.0, 1080.0);

/// The fraction of the view a sphere of `radius` metres seen from `distance` metres spans: twice
/// the projection's larger half scale, `½ · 1920/1080`, times the radius over the distance, the
/// distance at least a centimetre.
fn screen_size(radius: f64, distance: f64) -> f64 {
    2.0 * (0.5 * SCREEN.0 / SCREEN.1) * radius / distance.max(0.01)
}

/// The side of a pixel, in metres, `distance` metres away in the reference view: the inverse of
/// the texels per metre a unit sphere spans in the view's 1920 texels.
pub(super) fn pixel_at(distance: f64) -> f64 {
    1.0 / (screen_size(1.0, distance) * SCREEN.0 / 2.0)
}

/// An approximated layer's settings for one actor: the voxel accuracy and the simplification's
/// deviation, metres, and the atlas side, texels.
#[derive(Clone, Copy)]
struct Settings {
    accuracy: f64,
    deviation: f64,
    texture_size: usize,
}

/// The one resolution of an approximated `layer`'s settings for sources within `bounds` first seen
/// from `distance` metres, each the layer's own (`Hlod`) or the automatic rule:
/// - the accuracy, the voxel: the layer's metres, else the proxy layer's voxel (`proxy_lod::voxel`:
///   the screen size of the bounds' sphere at the first-seen distance in the view's 1920 pixels,
///   rounded, held between 50 and 900, the length per pixel of the box's major axis over it, times
///   1.95 / 3 (`DEFAULT_HLOD_VOXEL_PIXELS`) unless the layer names its own `accuracyPixels`); never
///   finer than the grid the solid is sampled on (`approximate::accuracy`), for in the proxy layer
///   the voxel is the grid: a part thinner than the grid is always thickened until it is sampled
///   (`1.5 · accuracy`), so it never leaves a hole;
/// - the deviation, the simplification's tolerance (`deviation`);
/// - the atlas side: the layer's, else `DEFAULT_HLOD_TEXTURE_SIZE`.
fn layer_settings(layer: &HlodLayer, bounds: ([f64; 3], [f64; 3]), distance: f64) -> Settings {
    let voxel = proxy_lod::voxel(layer, bounds, distance);
    Settings {
        accuracy: approximate::accuracy(bounds, voxel),
        deviation: deviation(layer, distance),
        texture_size: layer.texture_size,
    }
}

/// `layer`'s geometric deviation, metres, for actors first seen from `distance` metres: the
/// layer's metres, else its pixels — `DEFAULT_PIXEL_ERROR` by default — at that distance
/// (`pixel_at`). What an approximated shell is simplified within, and the LOD a merged layer takes
/// of each source (`mesh_merge`).
pub(crate) fn deviation(layer: &HlodLayer, distance: f64) -> f64 {
    (layer.deviation).unwrap_or_else(|| {
        layer.deviation_pixels.unwrap_or(crate::DEFAULT_PIXEL_ERROR) * pixel_at(distance)
    })
}

/// An object placed in world space: its material, positions, attributes and triangles.
pub(super) type Object = (
    Option<u64>,
    (
        Vec<f32>,
        Vec<trillion3d_page_codec::encode::Attribute>,
        Vec<u32>,
    ),
);

/// An HLOD actor: its flat mesh, its atlas, the closed mesh the layer above reads, its shell's
/// triangles after each step and the milliseconds each step took (`StageMs`).
pub(super) struct Made {
    pub flat: Flat,
    pub atlas: Atlas,
    pub closed: Placed,
    pub stages: Stages,
    pub stage_ms: StageMs,
}

/// What made an actor, or why it could not be: the reason and the triangles of its steps done.
pub(super) type Built = Result<Made, (&'static str, Stages)>;

/// A builder whose actor is a closed shell of its sources: the approximation's, or the proxy's.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(super) enum Shell {
    Approximate,
    Proxy,
}

/// What a layer's builder makes of a cell — a closed shell, its objects merged, or its voxels —:
/// the one mapping of `HlodBuilder` the jobs' estimate and make both match on (`world.rs`).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(super) enum Recipe {
    Shell(Shell),
    Merge,
    Voxel,
}

impl Recipe {
    /// What `builder` makes: an instanced layer's cells merge, as a merged layer's do.
    pub(super) fn of(builder: HlodBuilder) -> Self {
        match builder {
            HlodBuilder::Approximate => Self::Shell(Shell::Approximate),
            HlodBuilder::Proxy => Self::Shell(Shell::Proxy),
            HlodBuilder::Merge | HlodBuilder::Instanced => Self::Merge,
            HlodBuilder::Voxel => Self::Voxel,
        }
    }
}

/// The actor `shell`, HLOD layer `layer`'s builder, makes of `meshes` and of the objects `placed`
/// gives, first seen from `distance`: the one dispatch on the shell builders.
pub(super) fn built<P: std::borrow::Borrow<[Object]>>(
    (shell, layer): (Shell, &HlodLayer),
    meshes: &[Mesh],
    sources: (impl FnOnce() -> P, &Library),
    distance: f64,
) -> Built {
    match shell {
        Shell::Approximate => approximated(layer, meshes, sources, distance),
        Shell::Proxy => proxy_lod::built(layer, meshes, sources, distance),
    }
}

/// The whole milliseconds since `started`, a step's share of `StageMs`.
pub(super) fn millis(started: std::time::Instant) -> u64 {
    started.elapsed().as_millis() as u64
}

/// `objects` as the bakes' pieces, borrowed.
fn pieces(objects: &[Object]) -> Vec<Piece<'_>> {
    (objects.iter())
        .map(|(material, (positions, carried, indices))| Piece {
            material: sources::Material::Source(*material),
            positions,
            carried,
            indices,
        })
        .collect()
}

/// The bytes a texel of the atlas holds while it is baked: the three RGBA8 images (12), the
/// occupancy (4), the infill's hole ranks (4) and, were every texel a hole, the infill's own
/// (`raster::INFILL_HOLE_BYTES`) (`bake::project`, `raster.rs`).
const ATLAS_TEXEL_BYTES: usize = 20 + raster::INFILL_HOLE_BYTES;

/// The bytes a `texture_size` atlas holds while it is baked (`ATLAS_TEXEL_BYTES` a texel) and while
/// its three images are cooked side by side for `families` block families (`publish::images`,
/// `texture_preview::admission::cook_bytes`, thrice).
fn atlas_bytes(texture_size: usize, families: usize) -> usize {
    (ATLAS_TEXEL_BYTES * texture_size * texture_size).saturating_add(
        crate::texture_preview::admission::cook_bytes(texture_size as u32, families)
            .saturating_mul(3),
    )
}

/// The bytes a source triangle holds while an actor is made: its placed copy, its welded points
/// and triangles, its edges and components, its field's moments, the bake's traced copy and tree
/// (`approximate::scene`, `winding.rs`, `proxy_lod::mesh_to_volume`, `sources::traceable`,
/// `tree.rs`), or, merged, its unwrap's patches and charts and its traced copy (`unwrap.rs`,
/// `pack.rs`, `sources::traceable`).
pub(super) const SOURCE_TRIANGLE_BYTES: usize = 512;

/// The bytes the actor `shell`, HLOD layer `layer`'s builder, first seen from `distance` holds
/// while it is made from `triangles` source triangles whose solid's skin shows the grid's axes
/// `skin` square metres (`world.rs`) within `bounds`: its sources, its surface
/// (`approximate::surface_bytes`, `proxy_lod::surface_bytes`), and its atlas while it is baked and
/// its three images cooked side by side for `families` block families (`atlas_bytes`).
pub(super) fn working_bytes(
    (triangles, skin): (usize, f64),
    bounds: ([f64; 3], [f64; 3]),
    (shell, layer, distance, families): (Shell, &HlodLayer, f64, usize),
) -> usize {
    let surface = match shell {
        Shell::Approximate => {
            let accuracy = layer_settings(layer, bounds, distance).accuracy;
            approximate::surface_bytes(skin, bounds, accuracy)
        }
        Shell::Proxy => proxy_lod::surface_bytes(skin, bounds, (layer, distance)),
    };
    (triangles.saturating_mul(SOURCE_TRIANGLE_BYTES))
        .saturating_add(surface)
        .saturating_add(atlas_bytes(layer.texture_size, families))
}

/// How far each shell triangle lies from its sources, at its vertices, its edges' middles and its
/// centroid — each vertex and each edge measured once, whichever triangles share it —: the reach of
/// the bake's rays from that triangle, so each point of it finds the surface it stands for.
fn reach(
    points: &[[f64; 3]],
    triangles: &[[usize; 3]],
    sources: &tree::Tree<impl AsRef<[f32]> + Sync>,
) -> Vec<f64> {
    use rayon::prelude::*;
    use trillion3d_math::vecn::{distance2, lerp};
    let distance2_of = |p: [f64; 3]| distance2(sources.closest(p), p);
    let at_points: Vec<f64> = points.par_iter().map(|&p| distance2_of(p)).collect();
    // Each side of each triangle by its edge, its ends in order: one middle per edge.
    let named: Vec<(usize, usize)> = (triangles.iter())
        .flat_map(|&[a, b, c]| [(a, b), (b, c), (c, a)].map(|(u, v)| (u.min(v), u.max(v))))
        .collect();
    let (edges, sides) = first_seen::first_seen(named);
    let at_edges: Vec<f64> = (edges.par_iter())
        .map(|&(a, b)| distance2_of(lerp(points[a], points[b], 0.5)))
        .collect();
    (triangles.par_iter().enumerate())
        .map(|(t, &[a, b, c])| {
            let centroid = trillion3d_math::triangle::centroid([a, b, c].map(|v| points[v]));
            let corners = [a, b, c].map(|v| at_points[v]);
            let middles = [0, 1, 2].map(|k| at_edges[sides[t * 3 + k] as usize]);
            (corners.into_iter().chain(middles))
                .fold(distance2_of(centroid), f64::max)
                .sqrt()
        })
        .collect()
}

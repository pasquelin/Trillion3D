//! The meshes and flattened materials of the HLOD actors a layer builds (`chain/builds.rs` builds
//! their DAGs):
//! An approximated layer's actor approximates its cell's original objects — every object under the
//! cell, whatever its level, never an actor of a level below — (`approximate.rs`); each mesh is given
//! unique texture coordinates (`uv/charts.rs`, `uv/unwrap.rs`) and, read onto it through views of
//! them (`bake::capture`), those objects' materials: every detail under a pixel there — a window's
//! mullions, a ledge — lives in the texture. A merged layer merges those objects' own meshes
//! instead, each at the LOD it shows at the layer's screen size, and may flatten their materials
//! into one atlas of a cell per material (`merge`). A simplified layer remeshes those objects
//! through their volume, simplifies the result for the distance its actor is first drawn from and
//! transfers their materials onto it by rays (`simplify`).
//!
//! An approximated layer's settings are lengths, whatever the distance its actors are first seen
//! from (`layer_settings`): its accuracy, the voxel, and its deviation, what the simplification
//! may stray from the closed solid, each the layer's metres or the default. Every layer takes the
//! one atlas side its settings name, whatever its sources' draw distances — but a merged or a
//! simplified layer sizing its atlas by texel density (`merge::atlas_sides`). An actor's cell
//! doubles with each layer, so its texel does too.
//! The unique meshes and the approximated and baked layers live in `layers`.
mod approximate;
pub(crate) mod bake;
mod first_seen;
mod gpu;
mod lists;
pub(crate) mod merge;
pub(crate) mod mesh;
pub(crate) mod planar;
mod quadric;
pub(crate) mod sort;
pub(crate) mod units;

use crate::hlod::options::HlodMapSides;
use crate::{HlodBuilder, HlodLayer};
pub(crate) use approximate::{step, Placements, SourceMesh, StageMs, Stages, STAGE_COUNT};
pub(crate) use bake::appearance::tone_gap;
pub(crate) use bake::sources::{Library, Piece};
pub(crate) use bake::{Atlas, Flat, Sides};
mod layers;
mod simplify;
pub(crate) mod uv;
pub(crate) use layers::approximated;
use layers::unwrapped;
pub(crate) use simplify::{simplified, working_bytes as simplified_bytes};

/// The reference view every layer's pixel is measured in: 1920 texels wide, 1080 high, half angle
/// 45°, a full-HD screen.
const SCREEN: (f64, f64) = (1920.0, 1080.0);

/// The projection's larger half scale in the reference view, `½ · 1920/1080`.
const SCREEN_MULTIPLE: f64 = 0.5 * SCREEN.0 / SCREEN.1;

/// The fraction of the view a sphere of `radius` metres seen from `distance` metres spans: twice
/// the projection's larger half scale (`SCREEN_MULTIPLE`) times the radius over the distance, the
/// distance at least a centimetre.
fn screen_size(radius: f64, distance: f64) -> f64 {
    2.0 * SCREEN_MULTIPLE * radius / distance.max(0.01)
}

/// The side of a pixel, in metres, `distance` metres away in the reference view: the inverse of
/// the texels per metre a unit sphere spans in the view's 1920 texels.
pub(crate) fn pixel_at(distance: f64) -> f64 {
    1.0 / (screen_size(1.0, distance) * SCREEN.0 / 2.0)
}

/// An approximated layer's settings: the voxel accuracy and the simplification's deviation,
/// metres, and the atlas side, texels.
#[derive(Clone, Copy)]
struct Settings {
    accuracy: f64,
    deviation: f64,
    texture_size: usize,
}

/// An approximated `layer`'s settings, each the layer's own or the default, the same for every
/// actor of it whatever its bounds and the distance it is first seen from:
/// - the accuracy, the voxel: `DEFAULT_HLOD_ACCURACY` metres; the solid's grid then holds the
///   bounds' diagonal over it, from 64 voxels to the layer's clamp (`approximate::voxel_target`);
/// - the deviation, the simplification's geometric tolerance: `DEFAULT_HLOD_DEVIATION` metres;
/// - the atlas side: `DEFAULT_HLOD_TEXTURE_SIZE` texels, resolved when the layer is read.
fn layer_settings(layer: &HlodLayer) -> Settings {
    Settings {
        accuracy: layer.accuracy.unwrap_or(crate::DEFAULT_HLOD_ACCURACY),
        deviation: layer.deviation.unwrap_or(crate::DEFAULT_HLOD_DEVIATION),
        texture_size: layer.texture_size,
    }
}

/// What an actor stands for, one piece placed in world space: an original object of its cell, its
/// material of the source scene (`merge::Section`), its positions, attributes and triangles.
pub(crate) type Object = merge::Section;

/// An HLOD actor: its flat mesh, its atlas, its shell's triangles after each step and the
/// milliseconds each step took (`StageMs`).
pub(crate) struct Made {
    pub flat: Flat,
    pub atlas: Atlas,
    pub stages: Stages,
    pub stage_ms: StageMs,
}

/// What made an actor, or why it could not be: the reason and the triangles of its steps done.
pub(crate) type Built = Result<Made, (&'static str, Stages)>;

/// What a layer's builder makes of a cell — a closed shell, its objects merged, its voxels, or its
/// objects simplified through their volume —: the one mapping of `HlodBuilder` the jobs' estimate
/// and make both match on (`chain/builds.rs`).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Recipe {
    /// The approximation's closed shell of its sources (`approximate.rs`).
    Shell,
    Merge,
    Voxel,
    /// Its objects remeshed through their volume and simplified, their materials transferred
    /// (`simplify.rs`).
    Simplified,
}

impl Recipe {
    /// What `builder` makes; none for an instanced layer, whose objects stand as themselves, its
    /// actor's rows (`chain/builds/instanced.rs`).
    pub(crate) fn of(builder: HlodBuilder) -> Option<Self> {
        match builder {
            HlodBuilder::Approximate => Some(Self::Shell),
            HlodBuilder::Merge => Some(Self::Merge),
            HlodBuilder::Voxel => Some(Self::Voxel),
            HlodBuilder::Instanced => None,
            HlodBuilder::Simplify => Some(Self::Simplified),
        }
    }
}

/// Whether `layer` bakes an atlas on the GPU: a shell's, a merged layer's merging its materials
/// (`merge/tile.rs`), a simplified layer's flattened sources (`simplify/flattened.rs`); a voxel
/// layer, and a merged layer keeping its materials, bake none.
pub(crate) fn bakes(layer: &HlodLayer) -> bool {
    match Recipe::of(layer.builder) {
        Some(Recipe::Shell | Recipe::Simplified) => true,
        Some(Recipe::Merge) => layer.merge_materials,
        Some(Recipe::Voxel) | None => false,
    }
}

/// The whole milliseconds since `started`, a step's share of `StageMs`.
pub(crate) fn millis(started: std::time::Instant) -> u64 {
    started.elapsed().as_millis() as u64
}

/// What `run` returns, the whole milliseconds it took added to `ms`: a step's share of `StageMs`.
pub(crate) fn timed<T>(ms: &mut u64, run: impl FnOnce() -> T) -> T {
    let started = std::time::Instant::now();
    let made = run();
    *ms += millis(started);
    made
}

/// `objects` as the bakes' pieces, borrowed.
pub(crate) fn pieces(objects: &[Object]) -> Vec<Piece<'_>> {
    (objects.iter())
        .map(|(material, (positions, carried, indices))| Piece {
            material: *material,
            positions,
            carried,
            indices,
        })
        .collect()
}

/// The bytes a texel of the atlas holds while it is baked: the three RGBA8 images (12), the
/// occupancy (4), the infill's hole ranks (4), its entry in the list of samples the GPU is sent
/// (16) and, were every texel a hole or an empty one, the larger of the infill's and the
/// dilation's own (`raster::INFILL_HOLE_BYTES`, `raster::dilate`) (`bake::captured`, `raster.rs`).
/// What the device holds — the bake's batches, its scene — is counted beside, where the process's
/// footprint holds it (`bake::gpu::captured_device_bytes`).
const ATLAS_TEXEL_BYTES: usize = 36 + uv::raster::INFILL_HOLE_BYTES;

/// The bytes a texel of an atlas baking an emission map holds beside `ATLAS_TEXEL_BYTES`: its three
/// half-precision channels as read (6) and its RGBA8 image (4) (`bake::emission`).
const EMISSION_TEXEL_BYTES: usize = 10;

/// The bytes a `texture_size` atlas holds while it is baked `side` texels a side — its own side, or
/// larger when it is supersampled (`atlas::captured`) — (`ATLAS_TEXEL_BYTES` a texel), an emission
/// map's more where it bakes one (`emissive`, `EMISSION_TEXEL_BYTES`), and while its three images —
/// four with the emission — are cooked side by side for `families` block families
/// (`publish::images`, `texture::admission::cook_bytes`).
fn atlas_bytes((texture_size, side): (usize, usize), families: usize, emissive: bool) -> usize {
    let per_texel = ATLAS_TEXEL_BYTES + if emissive { EMISSION_TEXEL_BYTES } else { 0 };
    let baked = per_texel.saturating_mul(side * side);
    let images = if emissive { 4 } else { 3 };
    baked.saturating_add(
        crate::texture::admission::cook_bytes(texture_size as u32, families).saturating_mul(images),
    )
}

/// The largest side an approximated layer's atlas is baked at, texels: its `textureSize` where
/// its sizing names it or its maps' biased sides, the largest of its own sides where it names
/// them, the largest side a density may give where its sizing asks for one — the side that is
/// known once the shell is (`layers::atlas_sides`).
fn baked_side(layer: &HlodLayer) -> usize {
    (layer.approximation.sizing).baked_side(layer.texture_size, HlodMapSides::largest)
}

/// The bytes a source triangle holds while an actor is made: its placed copy, its welded points
/// and triangles, its edges and components, its field's moments, the bake's traced copy and tree
/// (`approximate::scene`, `winding.rs`, `sources::traceable`, `tree.rs`), or, simplified, its
/// unwrap's patches and charts and its traced copy (`unwrap.rs`, `chain/bundles.rs`,
/// `sources::traceable`), and the GPU bake's scene as the process packs it: its corners,
/// attributes and share of the tree's nodes as words (≈ 208, `bake/gpu/records.rs`), held once
/// until they go up. The queue's staging and the buffer they go to are the device's, counted
/// beside where the footprint holds them (`bake::gpu::captured_device_bytes`); the shell's scene
/// (`approximate/winding/pack.rs`), let go before the bake, is not counted. A merged actor's own
/// terms are `merge::working_bytes`'.
pub(crate) const SOURCE_TRIANGLE_BYTES: usize = 720;

/// The bytes the actor of approximated HLOD layer `layer` holds while it is made from `triangles`
/// source triangles whose solid's skin shows the grid's axes `skin` square metres
/// (`chain/builds.rs`) within `bounds`: its sources, its surface at the layer's accuracy
/// (`approximate::surface_bytes`), and its atlas while it is baked at the largest side it may
/// reach (`baked_side`) and its images cooked side by side for `families` block families
/// (`atlas_bytes`), and what its bake holds on the device where the footprint counts it
/// (`bake::gpu::captured_device_bytes`).
pub(crate) fn working_bytes(
    (triangles, skin): (usize, f64),
    bounds: ([f64; 3], [f64; 3]),
    (layer, families): (&HlodLayer, usize),
) -> usize {
    let approximation = &layer.approximation;
    let accuracy = layer_settings(layer).accuracy;
    let surface = approximate::surface_bytes(skin, bounds, (accuracy, approximation.voxel_clamp));
    let multisampling = approximation.capture.multisampling;
    let baked = baked_side(layer);
    let side = baked * bake::supersampling(baked, multisampling);
    let emissive = approximation.maps.emissive;
    (triangles.saturating_mul(SOURCE_TRIANGLE_BYTES))
        .saturating_add(surface)
        .saturating_add(atlas_bytes((baked, side), families, emissive))
        .saturating_add(bake::gpu::captured_device_bytes(triangles, side * side))
}

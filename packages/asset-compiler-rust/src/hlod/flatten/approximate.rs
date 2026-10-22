//! The approximated shell of HLOD 1 to 3, at the layer's accuracy and deviation, lengths whatever
//! the distance it is seen from (`flatten::layer_settings`), each step as the layer's settings
//! name it (`HlodApproximation`, their defaults in brackets):
//!
//! 1. the scene's parts (`approximate/scene.rs`): each source mesh read once, welded, in its own
//!    space, each object placing it an instance read through its transform; each connected
//!    component measured under each scale its placements carry, a thin one — planar within the
//!    desired thickness, the thickness multiplier (1.5) times the accuracy, under any of them —
//!    copied once per scale and thickened by a shell of half the thickness it lacks, a tiny thin
//!    one dropped, the others kept in the mesh's own space, every one read by its generalized
//!    winding number (Jacobson et al. 2013) to the second order (Barill et al. 2018,
//!    `approximate/winding.rs`); without thickening, each source mesh one part, none dropped;
//! 2. the solid, where the winding number passes its threshold (0.5), closed by marching cubes
//!    (Lorensen & Cline 1987) on cells of the bounds' largest side over the voxel count the
//!    accuracy asks — the bounds' diagonal over the accuracy, at least 64, at most the voxel clamp
//!    (1024) —, followed from the scene's seed points alone so only the cells near the surface are
//!    visited, each crossing found by four bisection steps; every value read on the GPU, a whole
//!    front of corners or a whole step of midpoints at once (`approximate/gpu.rs`);
//! 3. the gaps closed by a morphological closing at the gap distance (0.1 m,
//!    `approximate/morphology.rs`), its band's distances read on the GPU, unless the layer fills
//!    no gaps;
//! 4. simplified, volume kept (`approximate/simplify.rs`): to the geometric tolerance — past a
//!    million triangles a fast collapse pass at the accuracy down to a million, then down to 50000
//!    triangles, then to the tolerance —, or to a triangle count, each pass over the whole shell;
//! 5. the triangles no ray from outside reaches removed, a floor under the shell counting as an
//!    occluder (both on): nobody sees an HLOD from inside it or from under the ground; with them,
//!    where the layer discards under a ground plane (`groundClipping: 'discard'`), the triangles
//!    whose corners all lie on or under it;
//! 6. where the layer cuts at a ground plane (`'cut'`, `'cutAndFill'`), the shell cut along it and
//!    what lies under it removed, each cut loop filled flat with the second
//!    (`approximate/ground.rs`);
//! 7. hard normals past the crease angle (60°), else one normal a vertex.
//!
//! The scene lives in `scene` — its base cap, where the layer closes its base (`baseCapping`), in
//! `scene/base.rs` —, the solid in `solid`, the hidden faces in `occlusion`, the GPU's queries in
//! `gpu`; the tangents the shell's normal map is baked in, once it has its atlas coordinates
//! (`flatten::layers`), in `tangents`.
use crate::compiler::budget::admission::Step;
use crate::compiler::source::node_transform::Mat4;
use crate::hlod::flatten::{millis, timed};
use crate::hlod::options::{HlodApproximation, HlodGroundClipping, HlodOcclusion};
use std::sync::atomic::AtomicBool;
use trillion3d_math::geometry::aabb::centre;
mod gpu;
mod ground;
mod scene;
use scene::scene;
mod tangents;
pub(super) use tangents::tangents;
mod solid;
use solid::{solidify, voxel_target, SURFACE_CELL_BYTES};
pub(crate) mod grid_key;
pub(crate) mod marching;
pub(crate) mod morphology;
mod occlusion;
pub(crate) mod simplify;
pub(crate) mod winding;
use occlusion::{hard_normals, remove_occluded};
pub(super) use solid::surface_bytes;
use winding::Winding;

/// The least voxel count across the bounds' diagonal, so a small cluster is still shaped; the
/// most is the layer's voxel clamp (`HlodApproximation::voxel_clamp`).
const LEAST_VOXELS: usize = 64;
/// The bisection steps a crossing is found by: a sixteenth of a cell, finer than the simplifier
/// keeps.
const SEARCH_STEPS: usize = 4;
/// The first simplification's triangle count: a cheap pass that brings the solid's dense grid
/// mesh down before the tolerance's careful one.
const FIRST_PASS_TRIANGLES: usize = 50000;
/// The occlusion test's added rays and triangle samples: enough directions and points that a
/// triangle seen from outside is rarely taken for hidden.
const ADDED_RAYS: usize = 50;
const TRIANGLE_SAMPLES: usize = 50;

/// The approximated shell: its welded positions, its triangles, its hard normals, one per corner,
/// its triangles after each step (`Stages`) and the milliseconds of its steps (`StageMs`).
pub(crate) struct Shell {
    pub positions: Vec<f32>,
    pub indices: Vec<u32>,
    pub normals: Vec<[f32; 3]>,
    pub stages: Stages,
    pub ms: StageMs,
}

/// A shell's triangles after each step: the solid, the closing, the fast pre-pass, the first
/// simplification and the tolerance's.
pub(crate) type Stages = [usize; STAGE_COUNT];

/// The steps a shell's triangles are counted after (`Stages`).
pub(crate) const STAGE_COUNT: usize = 5;

/// The milliseconds an actor's making spent in each step, by the ranks of `step`.
pub(crate) type StageMs = [u64; step::COUNT];

/// The ranks of `StageMs`: the field (the winding parts), the marching, the closing, the
/// simplification, the unwrap and pack, the bake.
pub(crate) mod step {
    pub const FIELD: usize = 0;
    pub const MARCH: usize = 1;
    pub const CLOSE: usize = 2;
    pub const SIMPLIFY: usize = 3;
    pub const UNWRAP: usize = 4;
    pub const BAKE: usize = 5;
    pub const COUNT: usize = 6;
}

/// A source mesh of an approximated actor, in its own space: its level 0's positions and
/// triangles, its primitives end to end.
pub(crate) struct SourceMesh {
    pub positions: Vec<f32>,
    pub indices: Vec<u32>,
}

/// What an approximated actor's shell is made of: each source mesh once, in its own space, and
/// each object placing one — the mesh's rank and its matrix.
pub(crate) struct Placements {
    pub meshes: Vec<SourceMesh>,
    pub placed: Vec<(usize, Mat4)>,
}

/// The field the solid is closed on, its bounds and the seed points the surface is followed from.
struct Scene {
    winding: Winding,
    bounds: ([f64; 3], [f64; 3]),
    seeds: Vec<[f64; 3]>,
}

/// The approximated shell of the objects `placements` places at the voxel `accuracy`,
/// simplified within `deviation`, in metres, each step as `settings` names it; `Ok(Err)` with the
/// reason it gives up — a step left no triangle — and the triangles of the steps done; `Err` when
/// the GPU failed it or `cancelled` was raised.
pub(super) fn approximate(
    placements: &Placements,
    (accuracy, deviation): (f64, f64),
    settings: &HlodApproximation,
    cancelled: &AtomicBool,
) -> crate::Result<Result<Shell, (&'static str, Stages)>> {
    let mut stages: Stages = [0; STAGE_COUNT];
    let mut ms: StageMs = [0; step::COUNT];
    let Some(scene) = timed(&mut ms[step::FIELD], || {
        scene(placements, accuracy, settings)
    }) else {
        return Ok(Err(("no part in the scene", stages)));
    };
    let started = std::time::Instant::now();
    let target = voxel_target(scene.bounds, (accuracy, settings.voxel_clamp));
    // The ground plane's origin: the scene bounds' centre, raised or lowered to the plane.
    let mut ground = centre(scene.bounds.0, scene.bounds.1);
    ground[1] = settings.ground.height;
    let threshold = settings.winding_threshold;
    let surface = solidify(scene, (accuracy, threshold), target, cancelled)?;
    // The job's step from the surface on, counted as soon as its cells are known and kept until
    // the shell is made — through the closing and the simplification: the sources, held beside
    // the shell, and a crossed cell's share of the widest of the steps (`SURFACE_CELL_BYTES`).
    let held: usize = (placements.meshes.iter())
        .map(|mesh| (mesh.positions.len() + mesh.indices.len()) * 4)
        .sum();
    let _step =
        Step::begin(held.saturating_add(surface.cells().saturating_mul(SURFACE_CELL_BYTES)));
    let (positions, indices) = surface.mesh()?;
    ms[step::MARCH] = millis(started);
    stages[0] = indices.len() / 3;
    if indices.is_empty() {
        return Ok(Err(("the solid has no triangle", stages)));
    }
    // The gaps closed by the gap distance on the solid's own grid, `target` cells across.
    let (positions, indices) = timed(&mut ms[step::CLOSE], || {
        if settings.fill_gaps {
            morphology::close((positions, indices), settings.gap, target, cancelled)
        } else {
            Ok((positions, indices))
        }
    })?;
    stages[1] = indices.len() / 3;
    if indices.is_empty() {
        return Ok(Err(("the morphology mesh has no triangle", stages)));
    }
    // The simplification's share holds the occlusion filter and the hard normals after it.
    let started = std::time::Instant::now();
    let ((positions, indices), simplified) = simplify::simplify(
        (positions, indices),
        FIRST_PASS_TRIANGLES,
        (accuracy, deviation),
        settings,
    );
    stages[2..].copy_from_slice(&simplified);
    let visible = match settings.occlusion {
        HlodOcclusion::Visibility => {
            let discard = settings.ground.clipping == HlodGroundClipping::Discard;
            let under = discard.then_some(settings.ground.height);
            remove_occluded(&positions, &indices, (settings.occlude_from_below, under))
        }
        HlodOcclusion::None => indices,
    };
    if visible.is_empty() {
        return Ok(Err(("the occlusion filter removed every triangle", stages)));
    }
    let (kept, kept_indices, _) = crate::simplify::compact_region(&positions, &visible);
    let (kept, kept_indices) = match settings.ground.clipping {
        HlodGroundClipping::Cut => ground::cut_below(&kept, &kept_indices, ground, false),
        HlodGroundClipping::CutAndFill => ground::cut_below(&kept, &kept_indices, ground, true),
        HlodGroundClipping::None | HlodGroundClipping::Discard => (kept, kept_indices),
    };
    if kept_indices.is_empty() {
        return Ok(Err(("the ground cut removed every triangle", stages)));
    }
    let angle = settings.hard_normals.then_some(settings.hard_normal_angle);
    let normals = hard_normals(&kept, &kept_indices, angle);
    ms[step::SIMPLIFY] = millis(started);
    Ok(Ok(Shell {
        positions: kept,
        indices: kept_indices,
        normals,
        stages,
        ms,
    }))
}

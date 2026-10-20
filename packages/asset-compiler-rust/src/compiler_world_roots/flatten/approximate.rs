//! The approximated shell of HLOD 1 to 3, at fixed settings and the accuracy the layer is seen
//! at:
//!
//! 1. the scene's parts: each connected component of each placed mesh, welded, a thin one —
//!    planar within the desired thickness, 1.5 times the accuracy — thickened by a shell of half
//!    the thickness it lacks, a tiny thin one dropped, the others read by their generalized
//!    winding number (Jacobson et al. 2013, `winding.rs`);
//! 2. the solid, closed by marching cubes (Lorensen & Cline 1987) on cells of the bounds' largest
//!    side over the voxel count the accuracy asks — the bounds' diagonal over the accuracy, at
//!    least 64, at most 1024 —, followed from the scene's seed points so only the cells near the
//!    surface are visited, each crossing found by four bisection steps;
//! 3. the gaps closed by a morphological closing at the gap distance (`morphology.rs`), skipped
//!    when twice the distance is under the grid's cell;
//! 4. simplified to the geometric tolerance, volume kept (`simplify.rs`): down to 50000
//!    triangles, then to the tolerance;
//! 5. the triangles no ray from outside reaches removed, a floor under the shell counting as an
//!    occluder: nobody sees an HLOD from inside it or from under the ground;
//! 6. hard normals past 60°.
//! The scene lives in `scene`, the solid in `solid`, the hidden faces in `occlusion`.
use super::winding::{Shells, Winding};
mod scene;
use scene::scene;
mod solid;
use solid::{solidify, voxel_target};
mod occlusion;
use occlusion::{hard_normals, remove_occluded};
pub(super) use solid::{accuracy, surface_bytes};

/// The voxel count across the bounds' diagonal: at least 64, so a small cluster is still shaped,
/// at most 1024, so the grid's memory and time stay bounded on a large one.
const VOXEL_DIMENSION: (usize, usize) = (64, 1024);
/// The least thickness a part keeps, in voxels: a thinner one is thickened by a shell, so it does
/// not fall between the grid's corners and vanish.
const MIN_THICKNESS: f64 = 1.5;
/// A thin part's size, over the accuracy, under which it is a speck and dropped (see `scene`).
const TINY_PART: f64 = 0.05;
/// The winding number past which a point is inside: halfway between outside (0) and inside (1).
const WINDING_THRESHOLD: f64 = 0.5;
/// The gaps the closing fills, metres: a crack or an alley narrower than this is not seen far off.
const GAP_DISTANCE: f64 = 0.1;
/// The angle, degrees, past which two faces get separate normals: a crease, not a curve.
const HARD_NORMAL_ANGLE: f64 = 60.0;
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
/// the closed simplified mesh before the occlusion filter — the input the layer above reads —,
/// its triangles after each step (`Stages`) and the milliseconds of its steps (`StageMs`).
pub(crate) struct Shell {
    pub positions: Vec<f32>,
    pub indices: Vec<u32>,
    pub normals: Vec<[f32; 3]>,
    pub closed: Placed,
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

/// The ranks of `StageMs`: the field (the winding parts, the proxy's distance field), the
/// marching, the closing, the simplification, the unwrap and pack, the bake.
pub(crate) mod step {
    pub const FIELD: usize = 0;
    pub const MARCH: usize = 1;
    pub const CLOSE: usize = 2;
    pub const SIMPLIFY: usize = 3;
    pub const UNWRAP: usize = 4;
    pub const BAKE: usize = 5;
    pub const COUNT: usize = 6;
}

/// A mesh placed in world space: its positions and triangles.
pub(crate) type Placed = (Vec<f32>, Vec<u32>);

/// A placed mesh borrowed: its positions and triangles.
pub(crate) type Mesh<'a> = (&'a [f32], &'a [u32]);

/// The field the solid is closed on, its bounds and the seed points the surface is followed from.
struct Scene {
    winding: Winding,
    shells: Shells,
    bounds: ([f64; 3], [f64; 3]),
    seeds: Vec<[f64; 3]>,
}

/// The approximated shell of `meshes` at the voxel `accuracy`, simplified within `deviation`, in
/// metres; `Err` with the reason it gives up — a step left no triangle — and the triangles of the
/// steps done.
pub(super) fn approximate(
    meshes: &[Mesh],
    accuracy: f64,
    deviation: f64,
) -> Result<Shell, (&'static str, Stages)> {
    let mut stages: Stages = [0; STAGE_COUNT];
    let mut ms: StageMs = [0; step::COUNT];
    let started = std::time::Instant::now();
    let scene = scene(meshes, accuracy).ok_or(("no part in the scene", stages))?;
    ms[step::FIELD] = super::millis(started);
    let started = std::time::Instant::now();
    let target = voxel_target(scene.bounds, accuracy);
    let (positions, indices) = solidify(&scene, accuracy, target);
    drop(scene);
    ms[step::MARCH] = super::millis(started);
    stages[0] = indices.len() / 3;
    if indices.is_empty() {
        return Err(("the solid has no triangle", stages));
    }
    // The gaps closed by the gap distance on the solid's own grid, `target` cells across.
    let started = std::time::Instant::now();
    let (positions, indices) = super::morphology::close((positions, indices), GAP_DISTANCE, target);
    ms[step::CLOSE] = super::millis(started);
    stages[1] = indices.len() / 3;
    if indices.is_empty() {
        return Err(("the morphology mesh has no triangle", stages));
    }
    // The simplification's share holds the occlusion filter and the hard normals after it.
    let started = std::time::Instant::now();
    let ((positions, indices), simplified) = super::simplify::simplify(
        (positions, indices),
        FIRST_PASS_TRIANGLES,
        (accuracy, deviation),
    );
    stages[2..].copy_from_slice(&simplified);
    let visible = remove_occluded(&positions, &indices);
    if visible.is_empty() {
        return Err(("the occlusion filter removed every triangle", stages));
    }
    let (kept, kept_indices, _) = crate::qem::compact_region(&positions, &visible);
    let normals = hard_normals(&kept, &kept_indices);
    ms[step::SIMPLIFY] = super::millis(started);
    Ok(Shell {
        positions: kept,
        indices: kept_indices,
        normals,
        closed: (positions, indices),
        stages,
        ms,
    })
}

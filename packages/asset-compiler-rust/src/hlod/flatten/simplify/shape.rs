//! The simplified mesh of the sources' volume (`shaped`), in the method's frame, step by step:
//!
//! 1. the sources' signed distance field on the voxel (`resolution::voxel`), two voxels of band on
//!    each side, each voxel's closest source triangle kept (`volume::field`, `gaps::pruned_field`);
//! 2. the gaps closed (`volume::gaps`): the radius half the layer's merge distance, held to half
//!    the smallest side of the active voxels' box, closed when it passes a quarter voxel and the
//!    layer allows a dilation step;
//! 3. the surface drawn half a voxel outside the sources, adaptivity 0.01 (`volume::surface`), each
//!    vertex given the mean of its faces' normals (`convert::soup`);
//! 4. each vertex turned towards its nearest source's normal and drawn three quarters of the way
//!    onto that source (`nearest`), so a single-sided source does not come out thicker than it is;
//! 5. reduced for the screen size's pixels, a five-hundredth of the source triangles at least
//!    (`reduce`), in waves of slabs unless the layer asks for one pass (`serialSimplify`);
//! 6. the walls the reduction folded into each other pushed apart when the layer asks
//!    (`separateFoldedWalls`, `walls`);
//! 7. angle-weighted vertex normals, kept as the normals the transfer's rays follow; the vertices
//!    split at the layer's hard angle when it names one below 179° (`hard`); the vertex normals
//!    again, weighed as the layer says (`normals`).
use super::convert::soup;
use super::hard::split_hard;
use super::nearest::{project, take_normals, Nearest};
use super::normals::vertex_normals;
use super::proxy::Proxy;
use super::reduce::{reduce, Reference};
use super::sources::{InGrid, Sources};
use super::volume::gaps::{close_gaps, pruned_field};
use super::volume::surface::surface;
use super::volume::tree::Tree;
use super::walls::correct_walls;
use crate::hlod::flatten::units::CENTIMETRES;
use crate::hlod::flatten::{millis, step, StageMs, Stages, STAGE_COUNT};
use crate::hlod::options::{HlodNormalMethod, HlodSimplifying};
use crate::plugins::scene::cancel::check;
use std::sync::atomic::AtomicBool;

/// Where the surface is drawn, in voxels outside the sources.
const ISO: f32 = 0.5;

/// How freely the drawn surface merges its flat parts' cells.
const ADAPTIVITY: f32 = 0.01;

/// The least share of the source triangles the reduction keeps.
const RETAINED: f32 = 0.002;

/// The largest hard angle that splits vertices, degrees, exclusive.
const MOST_HARD_ANGLE: f64 = 179.0;

/// The simplified mesh, the tree of the sources' closest triangles it was shaped over where the
/// layer carries their vertex colours onto it (`allowVertexColors`), its triangles after each step
/// and the milliseconds of its steps.
pub(super) struct Shaped {
    pub proxy: Proxy,
    pub closest: Option<Tree<i32>>,
    pub stages: Stages,
    pub ms: StageMs,
}

/// The sides of the box of `field`'s active voxels, in voxels; none when no voxel is active.
fn active_sides(field: &Tree<f32>) -> Option<[i32; 3]> {
    let mut bounds: Option<([i32; 3], [i32; 3])> = None;
    for leaf in field.leaves() {
        for c in leaf.active().map(|pos| leaf.coord(pos)) {
            let (low, high) = bounds.get_or_insert((c, c));
            for k in 0..3 {
                low[k] = low[k].min(c[k]);
                high[k] = high[k].max(c[k]);
            }
        }
    }
    bounds.map(|(low, high)| std::array::from_fn(|k| high[k] - low[k] + 1))
}

/// The simplified mesh of `sources` sampled on `voxel` centimetres for a screen size of `pixels`,
/// as `settings` names its steps (module doc); `Ok(Err)` with the reason a step left nothing and
/// the triangles of the steps done; `Err` when `cancelled` was raised.
pub(super) fn shaped(
    sources: &Sources,
    (voxel, pixels): (f64, i32),
    settings: &HlodSimplifying,
    cancelled: &AtomicBool,
) -> crate::Result<Result<Shaped, (&'static str, Stages)>> {
    let mut stages: Stages = [0; STAGE_COUNT];
    let mut ms: StageMs = [0; step::COUNT];
    let started = std::time::Instant::now();
    let in_grid = InGrid {
        sources,
        inverse: 1.0 / voxel,
    };
    let mut field = pruned_field(&in_grid, voxel, cancelled)?;
    ms[step::FIELD] = millis(started);
    let started = std::time::Instant::now();
    let Some(sides) = active_sides(&field.distance) else {
        return Ok(Err(("the sources' field holds no surface", stages)));
    };
    let minor = f64::from(sides[0].min(sides[1]).min(sides[2])) * voxel;
    let radius = (0.5 * settings.gap_width * CENTIMETRES).min(0.5 * minor);
    let steps = settings.gap_steps as i32;
    if radius > 0.25 * voxel && steps > 0 {
        close_gaps(&mut field.distance, voxel, (radius, steps), cancelled)?;
    }
    ms[step::CLOSE] = millis(started);
    let started = std::time::Instant::now();
    let iso = voxel * f64::from(ISO);
    let mut mesh = soup(surface(&field.distance, voxel, iso, f64::from(ADAPTIVITY)));
    drop(field.distance);
    stages[0] = mesh.indices.len() / 3;
    stages[1] = stages[0];
    if mesh.indices.is_empty() {
        return Ok(Err(("the sources' surface has no triangle", stages)));
    }
    let nearest = Nearest {
        closest: &field.closest,
        sources,
        voxel,
    };
    take_normals(&nearest, &mut mesh);
    project(&nearest, &mut mesh);
    let closest = settings.vertex_colours.then_some(field.closest);
    ms[step::MARCH] = millis(started);
    check(cancelled)?;
    let started = std::time::Instant::now();
    let reference = Reference {
        low: sources.low,
        high: sources.high,
        polygons: sources.triangles.len(),
    };
    reduce(&mut mesh, &reference, (pixels, RETAINED), settings.serial);
    let mut proxy = Proxy::of(mesh);
    stages[2..].fill(proxy.indices.len() / 3);
    if proxy.indices.is_empty() {
        return Ok(Err(("the simplified mesh has no triangle", stages)));
    }
    if settings.folded_walls {
        correct_walls(&mut proxy, voxel);
    }
    proxy.normals = vertex_normals(
        &proxy.points,
        &proxy.indices,
        HlodNormalMethod::AngleWeighted,
    );
    proxy.transfer = proxy.normals.clone();
    if let Some(angle) = settings
        .hard_angle
        .filter(|&a| a > 0.0 && a < MOST_HARD_ANGLE)
    {
        split_hard(&mut proxy, angle as f32);
    }
    proxy.normals = vertex_normals(&proxy.points, &proxy.indices, settings.normal_method);
    ms[step::SIMPLIFY] = millis(started);
    Ok(Ok(Shaped {
        proxy,
        closest,
        stages,
        ms,
    }))
}

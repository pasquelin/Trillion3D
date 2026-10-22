//! The scene the solid is read from (`Scene`), the source meshes as their objects place them:
//! each mesh read once, in its own space, and sorted into the meshes the field wraps (`parts`);
//! each placement of a wrapped mesh one instance of it (`winding::Instance`), its box the wrapped
//! mesh's vertices placed, widened by its shell's radius, its seed points the wrapped mesh's,
//! placed. The scene's bounds hold every instance's box. Thickened, the scene is read as solids
//! (`winding.rs`). A thin test measures a part in its mesh's own space under each scale its
//! placements carry, so a turned placement reads its part as an unturned one does. Where the
//! layer caps its base (`baseCapping`), the cap closing it (`base`) is one more wrapped mesh,
//! placed as it is, last: its box and seed points join the scene's, and a flat cap, an open mesh,
//! makes the scene read as no solid.
use super::winding::{Affine, Instance, Winding, Wrapped};
use super::{Placements, Scene};
use crate::compiler::source::node_transform::Mat4;
use crate::hlod::options::{HlodApproximation, HlodBaseCapping};
use rayon::prelude::*;
use trillion3d_math::geometry::aabb::{aabb_of, merge_aabb};
use trillion3d_math::matrix::IDENTITY;
mod base;
mod parts;
mod topology;
use parts::{mesh_parts, Wrap};
use topology::seed_points;

/// A cap's vertices and its triangles' corners.
type Cap = (Vec<[f64; 3]>, Vec<[usize; 3]>);

/// How a scene's thin parts are read when its layer thickens them: the thickness a part is brought
/// to, metres, and the size under which a thin part is dropped, when the layer drops tiny parts.
#[derive(Clone, Copy)]
struct Thinning {
    thickness: f64,
    tiny: Option<f64>,
}

/// Wrapped mesh `wrap`'s instance of rank `rank` placed by `placing`: its box, the wrapped mesh's
/// vertices placed, widened by its shell's radius, and its seed points, placed.
fn instance((rank, wrap): (usize, &Wrap), placing: &Affine) -> (Instance, Vec<[f64; 3]>) {
    let (low, high) = aabb_of(wrap.points.iter().map(|&p| placing.apply(p)));
    let r = wrap.shell.unwrap_or(0.0);
    let bounds = (low.map(|x| x - r), high.map(|x| x + r));
    let seeds = wrap.seeds.iter().map(|&p| placing.apply(p)).collect();
    let inverse = placing.inverse();
    let instance = Instance {
        wrapped: rank,
        inverse,
        bounds,
    };
    (instance, seeds)
}

/// The scene of `placements` at `accuracy` as `settings` reads it (the module's steps); none when
/// it holds no triangle.
pub(super) fn scene(
    placements: &Placements,
    accuracy: f64,
    settings: &HlodApproximation,
) -> Option<Scene> {
    let thinning = settings.thicken.then(|| Thinning {
        thickness: settings.thickness * accuracy,
        // A speck: a hundredth of the tiny multiplier's voxels. Only dust far under a voxel is
        // dropped; any part large enough to show at the accuracy is kept, however thin.
        tiny: settings.drop_tiny.then(|| settings.tiny * accuracy / 100.0),
    });
    let mut placed: Vec<Vec<&Mat4>> = vec![Vec::new(); placements.meshes.len()];
    for (mesh, matrix) in &placements.placed {
        placed[*mesh].push(matrix);
    }
    // Each mesh's wrapped meshes, side by side, gathered in mesh order.
    let reading = (thinning, settings.render_meshes);
    let wraps: Vec<Wrap> = (placements.meshes.par_iter().zip(&placed))
        .filter(|(mesh, placed)| !mesh.indices.is_empty() && !placed.is_empty())
        .flat_map_iter(|(mesh, placed)| mesh_parts(mesh, placed, reading))
        .collect();
    let instances: Vec<(Instance, Vec<[f64; 3]>)> = (wraps.par_iter().enumerate())
        .flat_map_iter(|wrapped| {
            wrapped
                .1
                .placements
                .iter()
                .map(move |p| instance(wrapped, p))
        })
        .collect();
    if instances.is_empty() {
        return None;
    }
    let (mut low, mut high) = ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]);
    let mut seeds = Vec::new();
    let mut instances: Vec<Instance> = (instances.into_iter())
        .map(|(instance, placed)| {
            merge_aabb(&mut low, &mut high, instance.bounds.0, instance.bounds.1);
            seeds.extend(placed);
            instance
        })
        .collect();
    let cap = capped(&wraps, (low[1], accuracy), settings);
    let mut wrapped: Vec<Wrapped> = (wraps.into_iter())
        .map(|wrap| {
            let corners = wrap.triangles.iter().map(|t| t.map(|v| wrap.points[v]));
            (corners.collect(), wrap.shell)
        })
        .collect();
    let mut solids = thinning.is_some();
    if let Some((points, triangles)) = cap {
        let bounds = aabb_of(points.iter().copied());
        merge_aabb(&mut low, &mut high, bounds.0, bounds.1);
        seeds.extend(seed_points(&points));
        instances.push(Instance {
            wrapped: wrapped.len(),
            inverse: Affine::placing(&IDENTITY),
            bounds,
        });
        wrapped.push((
            triangles.iter().map(|t| t.map(|v| points[v])).collect(),
            None,
        ));
        solids &= settings.base.capping == HlodBaseCapping::ConvexSolid;
    }
    Some(Scene {
        winding: Winding::new(wrapped, instances, solids),
        bounds: (low, high),
        seeds,
    })
}

/// The cap closing the base of the scene of `wraps`, its lowest height `bottom`, at `accuracy`, as
/// `settings` names it (`baseCapping`, `base::base_mesh`): the convex hull of every instance's
/// placed vertices within the base's height above the bottom — the layer's, or twice the accuracy
/// —, flat, or extruded into a slab of the layer's thickness — or the thickening's, where the
/// layer thickens thin parts, else one and a quarter voxels —; none when the layer caps nothing or
/// no hull forms.
fn capped(
    wraps: &[Wrap],
    (bottom, accuracy): (f64, f64),
    settings: &HlodApproximation,
) -> Option<Cap> {
    let base = settings.base;
    let or = |named: f64, method: f64| if named != 0.0 { named } else { method };
    let thickness = match base.capping {
        HlodBaseCapping::None => return None,
        HlodBaseCapping::ConvexPolygon => 0.0,
        HlodBaseCapping::ConvexSolid => {
            let thickening = if settings.thicken {
                settings.thickness
            } else {
                1.25
            };
            or(base.thickness, thickening * accuracy)
        }
    };
    let placed: Vec<Vec<[f64; 3]>> = (wraps.iter())
        .flat_map(|wrap| {
            (wrap.placements.iter()).map(move |p| wrap.points.iter().map(|&q| p.apply(q)).collect())
        })
        .collect();
    base::base_mesh(&placed, bottom, or(base.height, 2.0 * accuracy), thickness)
}

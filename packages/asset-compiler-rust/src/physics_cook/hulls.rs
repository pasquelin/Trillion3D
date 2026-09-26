//! The convex hulls of a moving body's mesh, cooked by native Jolt (`cook_hulls`,
//! `cook_hull_planes`, `cook/cook.cpp`) with the mass, centre of mass and inertia Jolt weighs them
//! at: the page restores the compound, it builds no hull and weighs nothing.
use super::cut::store_shape;
use super::decompose::decompose;
use super::taken;
use crate::compiler_accessor_create::accessor;
use crate::compiler_validate::{item, required_index, values};
use crate::{Options, Result};
use serde_json::{json, Value};

/// Density a body is weighed at, kg/m³: the runtime's (`SHAPE_DENSITY`, `src/commands.cpp`).
pub(super) const DENSITY: f32 = 1000.0;

extern "C" {
    fn cook_hulls(
        points: *const f32,
        counts: *const u32,
        parts: u32,
        density: f32,
        mass: *mut f32,
        out: *mut *const u8,
        bytes: *mut u32,
    ) -> u32;
    fn cook_hull_planes(points: *const f32, count: u32, planes: *mut f32, room: u32) -> u32;
}

/// Mass, centre of mass and inertia about it (column-major) of a cooked body.
pub(super) struct MassProperties {
    pub mass: f32,
    pub centre: [f32; 3],
    pub inertia: [f32; 9],
}

/// A compound of convex hulls (one hull alone when `parts` has one) at `density` kg/m³.
pub(super) fn hulls_shape(parts: &[Vec<f32>], density: f32) -> Result<(Vec<u8>, MassProperties)> {
    let points: Vec<f32> = parts.concat();
    let counts: Vec<u32> = parts.iter().map(|p| (p.len() / 3) as u32).collect();
    let mut mass = [0f32; 13];
    let (mut out, mut bytes) = (std::ptr::null(), 0u32);
    // SAFETY: `counts` sums to the points `points` holds; `mass` has the 13 floats written.
    let status = unsafe {
        let (p, c, m) = (points.as_ptr(), counts.as_ptr(), mass.as_mut_ptr());
        cook_hulls(p, c, parts.len() as u32, density, m, &mut out, &mut bytes)
    };
    let shape = taken(status, out, bytes, "convex hulls")?;
    let properties = MassProperties {
        mass: mass[0],
        centre: [mass[1], mass[2], mass[3]],
        inertia: mass[4..13].try_into().expect("nine floats"),
    };
    Ok((shape, properties))
}

/// The planes of the convex hull of `points` (normal and constant each; inside is negative), none
/// when the points have no hull.
pub(super) fn hull_planes(points: &[f32]) -> Vec<[f32; 4]> {
    const ROOM: usize = 1024;
    let mut planes = vec![[0f32; 4]; ROOM];
    // SAFETY: `planes` has room for `ROOM` planes of four floats.
    let count = unsafe {
        let out = planes.as_mut_ptr().cast::<f32>();
        cook_hull_planes(points.as_ptr(), (points.len() / 3) as u32, out, ROOM as u32)
    };
    planes.truncate(count as usize);
    planes
}

/// Source positions and triangles of every triangle primitive of mesh `mesh`.
fn mesh_triangles(g: &Value, bin: &[u8], mesh: usize) -> Result<(Vec<f32>, Vec<u32>)> {
    let (mut pos, mut triangles) = (Vec::new(), Vec::new());
    let primitives = values(item(values(g, "meshes")?, mesh, "mesh")?, "primitives")?;
    for p in primitives
        .iter()
        .filter(|p| p.get("mode").is_none_or(|m| m == 4))
    {
        let base = (pos.len() / 3) as u32;
        let positions = accessor(
            g,
            bin,
            required_index(p.pointer("/attributes/POSITION"), "POSITION")?,
            None,
        )?;
        let local: Vec<u32> = match p.get("indices") {
            Some(index) => {
                accessor(g, bin, required_index(Some(index), "indices")?, None)?.collect_u32()?
            }
            None => (0..positions.count as u32).collect(),
        };
        pos.extend(positions.collect_f32()?);
        triangles.extend(local.iter().map(|i| i + base));
    }
    Ok((pos, triangles))
}

/// The cooked hulls of mesh `mesh`, in its frame — one hull, or a decomposition within the mesh's
/// grain, its mean edge length, published as `tolerance` — with their mass properties.
pub(super) fn cooked_hulls(
    o: &Options,
    (g, bin): (&Value, &[u8]),
    mesh: usize,
    one_hull: bool,
) -> Result<Value> {
    let (pos, triangles) = mesh_triangles(g, bin, mesh)?;
    let edges = triangles
        .as_chunks::<3>()
        .0
        .iter()
        .flat_map(|t| [(t[0], t[1]), (t[1], t[2]), (t[2], t[0])]);
    let (sum, count) = edges.fold((0.0f64, 0usize), |(sum, count), (a, b)| {
        let d = (0..3).map(|k| (pos[a as usize * 3 + k] - pos[b as usize * 3 + k]) as f64);
        (sum + d.map(|v| v * v).sum::<f64>().sqrt(), count + 1)
    });
    let tolerance = sum / count.max(1) as f64;
    let parts = if one_hull {
        vec![pos]
    } else {
        decompose(&pos, &triangles, tolerance)
    };
    let (bytes, mass) = hulls_shape(&parts, DENSITY)?;
    let mut shape = store_shape(o, &bytes)?;
    shape["type"] = json!("cooked");
    shape["parts"] = json!(parts.len());
    shape["tolerance"] = json!(tolerance);
    shape["mass"] = json!({"mass":mass.mass,"centerOfMass":mass.centre,"inertia":mass.inertia});
    Ok(shape)
}

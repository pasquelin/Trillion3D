//! The convex hulls of a moving body's mesh, cooked by native Jolt (`cook_hulls`,
//! `cook_hull_planes`, `cook/cook.cpp`) with the mass, centre of mass and inertia Jolt weighs them
//! at: the page restores the compound, it builds no hull and weighs nothing.
use super::cut::store_shape;
use super::decompose::decompose;
use super::{refused, taken};
use crate::compiler_accessor_create::accessor;
use crate::compiler_validate::{item, required_index, values};
use crate::compiler_world::{transform_point, Mat4};
use crate::qem::compact_region;
use crate::shared_math::{length, sub};
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

/// A compound of convex hulls (one hull alone when `parts` has one) at `DENSITY`, and its `mass`,
/// `centerOfMass` and `inertia` about it (column-major).
pub(super) fn hulls_shape(parts: &[Vec<f32>]) -> Result<(Vec<u8>, Value)> {
    let points: Vec<f32> = parts.concat();
    let counts: Vec<u32> = parts.iter().map(|p| (p.len() / 3) as u32).collect();
    let mut m = [0f32; 13];
    let (mut out, mut bytes) = (std::ptr::null(), 0u32);
    // SAFETY: `counts` sums to the points `points` holds; `m` has the 13 floats written.
    let status = unsafe {
        let (p, c) = (points.as_ptr(), counts.as_ptr());
        cook_hulls(
            p,
            c,
            parts.len() as u32,
            DENSITY,
            m.as_mut_ptr(),
            &mut out,
            &mut bytes,
        )
    };
    let shape = taken(status, out, bytes, "convex hulls")?;
    Ok((
        shape,
        json!({"mass":m[0],"centerOfMass":&m[1..4],"inertia":&m[4..13]}),
    ))
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
        if local.iter().any(|&i| i as usize >= positions.count) {
            return Err(refused(format!("Mesh {mesh} indexes a vertex it lacks.")));
        }
        pos.extend(positions.collect_f32()?);
        triangles.extend(local.iter().map(|i| i + base));
    }
    Ok((pos, triangles))
}

/// The mesh's grain: the mean length of its triangles' edges.
fn mean_edge(pos: &[f32], triangles: &[u32]) -> f64 {
    let at = |i: u32| [0, 1, 2].map(|k| pos[i as usize * 3 + k] as f64);
    let edges = triangles
        .as_chunks::<3>()
        .0
        .iter()
        .flat_map(|t| [(t[0], t[1]), (t[1], t[2]), (t[2], t[0])]);
    let lengths: Vec<f64> = edges.map(|(a, b)| length(sub(at(a), at(b)))).collect();
    lengths.iter().sum::<f64>() / lengths.len().max(1) as f64
}

/// The cooked hulls of mesh `mesh`, in its frame or moved by `frame` — one hull, or a
/// decomposition within the mesh's grain, its mean edge length, published as `tolerance` — with
/// their mass properties.
pub(super) fn cooked_hulls(
    o: &Options,
    (g, bin): (&Value, &[u8]),
    (mesh, frame): (usize, Option<Mat4>),
    one_hull: bool,
) -> Result<Value> {
    let (mut pos, triangles) = mesh_triangles(g, bin, mesh)?;
    if let Some(m) = frame {
        for p in pos.as_chunks_mut::<3>().0 {
            *p = transform_point(&m, p.map(f64::from)).map(|v| v as f32);
        }
    }
    let tolerance = mean_edge(&pos, &triangles);
    let parts = if one_hull {
        vec![compact_region(&pos, &triangles).0]
    } else {
        decompose(&pos, &triangles, tolerance)
    };
    let flat = || refused(format!("Mesh {mesh} is flat: it has no volume to weigh."));
    if parts.is_empty() {
        return Err(flat());
    }
    let (bytes, mass) = hulls_shape(&parts)?;
    if mass["mass"].as_f64().is_none_or(|m| m <= 0.0) {
        return Err(flat());
    }
    let mut shape = store_shape(o, &bytes)?;
    shape["type"] = json!("cooked");
    shape["parts"] = json!(parts.len());
    shape["tolerance"] = json!(tolerance);
    shape["mass"] = mass;
    Ok(shape)
}

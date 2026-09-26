//! The convex hull a shapeless moving body collides by, cooked by native Jolt (`cook_hull`,
//! `cook/cook.cpp`) around the closed mesh it wraps, and weighed from that mesh (`mass.rs`): the
//! page restores the hull and hands Jolt the mass, it builds and weighs nothing.
use super::cut::store_shape;
use super::mass::solid_mass;
use super::{refused, taken};
use crate::compiler_accessor_create::accessor;
use crate::compiler_validate::{item, required_index, values};
use crate::compiler_world::{transform_point, Mat4};
use crate::dag::clusters::weld_positions;
use crate::qem::compact_region;
use crate::{Options, Result};
use serde_json::{json, Value};

extern "C" {
    fn cook_hull(points: *const f32, count: u32, out: *mut *const u8, bytes: *mut u32) -> u32;
}

/// Jolt's `ConvexHullShape` of `points` (3 floats each).
pub(super) fn hull_shape(points: &[f32]) -> Result<Vec<u8>> {
    let (mut out, mut bytes) = (std::ptr::null(), 0u32);
    // SAFETY: `points` holds the `len / 3` points passed with it.
    let status = unsafe {
        cook_hull(
            points.as_ptr(),
            (points.len() / 3) as u32,
            &mut out,
            &mut bytes,
        )
    };
    taken(status, out, bytes, "convex hull")
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

/// The cooked hull of mesh `mesh`, in its frame or moved by `frame` into the body's, with the
/// exact `mass` of the solid it bounds at the body's scale when `weigh` names it.
pub(super) fn cooked_hull(
    o: &Options,
    (g, bin): (&Value, &[u8]),
    (mesh, frame): (usize, Option<Mat4>),
    weigh: Option<[f64; 3]>,
) -> Result<Value> {
    let (mut pos, triangles) = mesh_triangles(g, bin, mesh)?;
    if let Some(m) = frame {
        for p in pos.as_chunks_mut::<3>().0 {
            *p = transform_point(&m, p.map(f64::from)).map(|v| v as f32);
        }
    }
    // One point per position: seam copies neither split an edge nor add a hull point.
    let weld = weld_positions(&pos, &triangles);
    let welded: Vec<u32> = triangles.iter().map(|&i| weld[i as usize]).collect();
    let mass = weigh
        .map(|scale| solid_mass(&pos, &welded, scale, mesh))
        .transpose()?;
    let mut shape = store_shape(o, &hull_shape(&compact_region(&pos, &welded).0)?)?;
    shape["type"] = json!("cooked");
    if let Some(mass) = mass {
        shape["mass"] = mass;
    }
    Ok(shape)
}

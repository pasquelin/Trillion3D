//! The convex hull a shapeless moving body collides by, cooked by native Jolt (`cook_hull`,
//! `cook/cook.cpp`) around the closed mesh it wraps, and weighed from that mesh (`mass.rs`): the
//! page restores the hull and hands Jolt the mass, it builds and weighs nothing.
use super::cut::store_shape;
use super::mass::solid_mass;
use super::{refused, taken};
use crate::compiler_primitive::triangles::mesh_triangles;
use crate::compiler_world::Mat4;
use crate::qem::welded_region;
use crate::{Options, Result};
use serde_json::{json, Value};
use trillion3d_math::matrix::transform_point_f32;

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

/// Mesh `mesh` as a body collides by it: its positions, its triangles welded, and the `cooked`
/// hull Jolt built around them, once for every scale its bodies are weighed at.
pub(super) struct Hull {
    mesh: usize,
    pos: Vec<f32>,
    welded: Vec<u32>,
    shape: Value,
}

impl Hull {
    /// The hull's `physics.json` shape, with the exact `mass` of the solid it bounds at the body's
    /// scale when `weigh` names it.
    pub(super) fn weighed(&self, weigh: Option<[f64; 3]>) -> Result<Value> {
        let mut shape = self.shape.clone();
        if let Some(scale) = weigh {
            shape["mass"] = solid_mass(&self.pos, &self.welded, scale, self.mesh)?;
        }
        Ok(shape)
    }

    /// The breakable body's pieces of this mesh, seeded and weighed at a scale as `cut` says
    /// (`pieces.rs`).
    pub(super) fn pieces(&self, o: &Options, cut: (u64, [f64; 3])) -> Result<Vec<Value>> {
        super::pieces::pieces(o, (&self.pos, &self.welded, self.mesh), cut)
    }
}

/// The `cooked` shape of Jolt's convex hull of `points`, stored as a SHA-addressed object.
pub(super) fn cooked_shape(o: &Options, points: &[f32]) -> Result<Value> {
    let mut shape = store_shape(o, &hull_shape(points)?)?;
    shape["type"] = json!("cooked");
    Ok(shape)
}

/// The hull of mesh `mesh`, in its frame or moved by `frame` into the body's.
pub(super) fn cooked_hull(
    o: &Options,
    (g, bin): (&Value, &[u8]),
    (mesh, frame): (usize, Option<Mat4>),
) -> Result<Hull> {
    // A collider may name a node the scene never draws: its unread mesh refuses the body alone.
    let (mut pos, triangles) = mesh_triangles(g, bin, mesh).map_err(|e| refused(e.message))?;
    if let Some(m) = frame {
        for p in pos.as_chunks_mut::<3>().0 {
            *p = transform_point_f32(&m, *p);
        }
    }
    // One point per position: seam copies neither split an edge nor add a hull point.
    let (points, _, welded) = welded_region(&pos, &triangles);
    let shape = cooked_shape(o, &points)?;
    Ok(Hull {
        mesh,
        pos,
        welded,
        shape,
    })
}

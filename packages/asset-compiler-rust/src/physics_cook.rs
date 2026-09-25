//! Stage `physics-cook`: the colliders of a compiled scene, cooked at build time by native Jolt
//! (`packages/physics-jolt-wasm/cook/cook.cpp`, linked by `build.rs` from the same pinned
//! submodule as the web module) and written with Jolt's own binary state. At runtime, loading a
//! collider is a decode and a copy: no tree, hull or mass is computed in the browser.
//!
//! What it makes, per primitive: a collision level cut through the DAG at one tolerance derived
//! from the object (`cut.rs`), split into tiles aligned on the culling hierarchy, each a Jolt
//! `MeshShape` stored as a SHA-addressed object like the pages; a regular grid becomes a height
//! field (`height.rs`). Per scene: `physics.json` (`stage.rs`), each placement carrying the matter its
//! source declares through `KHR_physics_rigid_bodies` (`declared.rs`), and the soft bodies its nodes
//! declare, each Jolt's `SoftBodySharedSettings` as the physics worker would build them (`soft.rs`).
use crate::dag::{CullingNode, DagCluster};
use crate::{CompilerError, Options, Result};
use serde_json::{json, Value};

mod cut;
#[cfg(test)]
mod cut_tests;
mod declared;
pub(crate) mod hausdorff;
mod height;
#[cfg(test)]
mod small_tests;
mod soft;
#[cfg(test)]
mod soft_page_tests;
mod soft_record;
#[cfg(test)]
mod soft_tests;
mod stage;
#[cfg(test)]
mod tests;

pub(crate) use stage::stage_physics;

/// The stage contract: its name and version, which enter `physics.json` and the cache key.
pub const PHYSICS_COOK_STAGE: &str = "physics-cook";
pub const PHYSICS_COOK_VERSION: u32 = 5;
/// Version of `physics.json`, its own: a reader refuses any other.
pub const PHYSICS_FORMAT_VERSION: u32 = 2;
/// The Jolt commit the cook links: shapes are Jolt's binary state, readable by this Jolt alone.
pub const JOLT_COMMIT: &str = env!("JOLT_COMMIT");
/// Name of the product beside the manifest.
pub const PHYSICS_FILE: &str = "physics.json";

/// The collision of one primitive (`cut::cook_primitive`), or `{"refused": reason}` when Jolt
/// refuses one of its shapes: that primitive collides with nothing, and `physics.json`'s report
/// names it; the compile goes on, its render untouched.
pub(crate) fn cook_primitive(
    o: &Options,
    dag: &[DagCluster],
    order: &[usize],
    culling: &[CullingNode],
    pos: &[f32],
    source: &[u32],
) -> Result<Value> {
    match cut::cook_primitive(o, dag, order, culling, pos, source) {
        Err(e) if e.code == PHYSICS_COOK_FAILED => Ok(json!({"refused":e.message})),
        cooked => cooked,
    }
}

extern "C" {
    fn cook_mesh(
        vertices: *const f32,
        vertex_count: u32,
        indices: *const u32,
        triangle_count: u32,
        out: *mut *const u8,
        bytes: *mut u32,
    ) -> u32;
    fn cook_height_field(
        samples: *const f32,
        sample_count: u32,
        offset: *const f32,
        scale: *const f32,
        out: *mut *const u8,
        bytes: *mut u32,
    ) -> u32;
    fn cook_soft_body(
        vertices: *const f32,
        vertex_count: u32,
        scale: *const f32,
        corners: *const u32,
        corner_count: u32,
        stretch: f32,
        bend: f32,
        out: *mut *const u8,
        bytes: *mut u32,
    ) -> u32;
}

/// The code of a shape Jolt refuses: the primitive gets no collider, named in the report.
pub(crate) const PHYSICS_COOK_FAILED: &str = "PHYSICS_COOK_FAILED";

/// Copies the bytes the cook left for this thread, or names what it refused and Jolt's reason.
fn taken(status: u32, out: *const u8, bytes: u32, what: &str) -> Result<Vec<u8>> {
    // SAFETY: the cook left `bytes` bytes at `out`, valid until this thread's next call.
    let left = (!out.is_null()).then(|| unsafe { std::slice::from_raw_parts(out, bytes as usize) });
    match (status, left) {
        (0, Some(left)) => Ok(left.to_vec()),
        (_, left) => Err(CompilerError::new(
            PHYSICS_COOK_FAILED,
            format!(
                "Jolt refused the {what}: {}",
                String::from_utf8_lossy(left.unwrap_or_default())
            ),
        )),
    }
}

/// A static `MeshShape` of `triangles` (indices into `vertices`), without material: a tile is of
/// its collider's, named in `physics.json`.
pub(crate) fn mesh_shape(vertices: &[f32], triangles: &[u32]) -> Result<Vec<u8>> {
    let (mut out, mut bytes) = (std::ptr::null(), 0u32);
    // SAFETY: every pointer names a live slice of the length passed with it.
    let status = unsafe {
        cook_mesh(
            vertices.as_ptr(),
            (vertices.len() / 3) as u32,
            triangles.as_ptr(),
            (triangles.len() / 3) as u32,
            &mut out,
            &mut bytes,
        )
    };
    taken(status, out, bytes, "triangle mesh")
}

/// A `HeightFieldShape` of `size`² samples placed by `offset` and `scale`.
pub(crate) fn height_field_shape(
    samples: &[f32],
    size: usize,
    offset: [f32; 3],
    scale: [f32; 3],
) -> Result<Vec<u8>> {
    let (mut out, mut bytes) = (std::ptr::null(), 0u32);
    // SAFETY: `samples` holds `size`² floats, `offset` and `scale` three each.
    let status = unsafe {
        let (o, s) = (offset.as_ptr(), scale.as_ptr());
        cook_height_field(samples.as_ptr(), size as u32, o, s, &mut out, &mut bytes)
    };
    taken(status, out, bytes, "height field")
}

/// A soft body's `SoftBodySharedSettings`, built by the physics worker's own builder
/// (`src/softSettings.h`): `vertices` (`x, y, z, mass` each, a mass of 0 a pin) scaled by `scale`,
/// joined by the triangles of `corners` or, with none, each to the next; compliances `stretch`
/// and `bend` (`INFINITY` for none).
pub(crate) fn soft_settings(
    vertices: &[f32],
    scale: [f32; 3],
    corners: &[u32],
    stretch: f32,
    bend: f32,
) -> Result<Vec<u8>> {
    let (mut out, mut bytes) = (std::ptr::null(), 0u32);
    // SAFETY: every pointer names a live slice of the length passed with it, `scale` three floats.
    let status = unsafe {
        cook_soft_body(
            vertices.as_ptr(),
            (vertices.len() / 4) as u32,
            scale.as_ptr(),
            corners.as_ptr(),
            corners.len() as u32,
            stretch,
            bend,
            &mut out,
            &mut bytes,
        )
    };
    taken(status, out, bytes, "soft body")
}

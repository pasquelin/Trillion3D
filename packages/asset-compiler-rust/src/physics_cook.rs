//! Stage `physics-cook`: the colliders of a compiled scene, cooked at build time by native Jolt
//! (`packages/physics-jolt-wasm/cook/cook.cpp`, linked by `build.rs` from the same pinned
//! submodule as the web module) and written with Jolt's own binary state. At runtime, loading a
//! collider is a decode and a copy: no tree, hull or mass is computed in the browser.
//!
//! What it makes, per primitive: a collision level cut through the DAG at one tolerance derived
//! from the object (`cut.rs`), split into tiles aligned on the culling hierarchy, each a Jolt
//! `MeshShape` stored as a SHA-addressed object like the pages; a regular grid becomes a height
//! field (`height.rs`). Per scene: `physics.json` (`stage.rs`), each placement carrying the matter its
//! source declares through `KHR_physics_rigid_bodies` (`declared.rs`).
use crate::{CompilerError, Result};

mod cut;
mod declared;
mod hausdorff;
mod height;
mod stage;
#[cfg(test)]
mod tests;

pub(crate) use cut::cook_primitive;
pub(crate) use stage::stage_physics;

/// The stage contract: its name and version, which enter `physics.json` and the cache key.
pub const PHYSICS_COOK_STAGE: &str = "physics-cook";
pub const PHYSICS_COOK_VERSION: u32 = 2;
/// Version of `physics.json`, its own: a reader refuses any other.
pub const PHYSICS_FORMAT_VERSION: u32 = 1;
/// The Jolt commit the cook links: shapes are Jolt's binary state, readable by this Jolt alone.
pub const JOLT_COMMIT: &str = env!("JOLT_COMMIT");
/// Name of the product beside the manifest.
pub const PHYSICS_FILE: &str = "physics.json";

extern "C" {
    fn cook_mesh(
        vertices: *const f32,
        vertex_count: u32,
        indices: *const u32,
        triangle_count: u32,
        materials: *const u32,
        material_count: u32,
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
}

fn refused(what: &str) -> CompilerError {
    CompilerError::new("PHYSICS_COOK_FAILED", format!("Jolt refused the {what}"))
}

/// Copies the bytes the cook left for this thread, or names what it refused.
fn taken(status: u32, out: *const u8, bytes: u32, what: &str) -> Result<Vec<u8>> {
    if status != 0 || out.is_null() {
        return Err(refused(what));
    }
    // SAFETY: the cook returned `bytes` bytes at `out`, valid until this thread's next call.
    Ok(unsafe { std::slice::from_raw_parts(out, bytes as usize) }.to_vec())
}

/// A static `MeshShape` of `triangles` (indices into `vertices`), every triangle of material 0.
pub(crate) fn mesh_shape(vertices: &[f32], triangles: &[u32]) -> Result<Vec<u8>> {
    let materials = vec![0u32; triangles.len() / 3];
    let (mut out, mut bytes) = (std::ptr::null(), 0u32);
    // SAFETY: every pointer names a live slice of the length passed with it.
    let status = unsafe {
        cook_mesh(
            vertices.as_ptr(),
            (vertices.len() / 3) as u32,
            triangles.as_ptr(),
            (triangles.len() / 3) as u32,
            materials.as_ptr(),
            1,
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

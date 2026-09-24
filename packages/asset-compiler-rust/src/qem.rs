//! Region simplification for the cluster DAG.
use crate::{invalid, Result};
use meshopt::{SimplifyOptions, VertexDataAdapter};
use std::collections::HashMap;
pub struct SimplifiedMesh {
    pub indices: Vec<u32>,
    pub error_object: f64,
    pub triangles: usize,
}
/// Region-local vertex buffer plus the table that maps a local index back to its source index.
/// The dense table is used whenever it is not much larger than the index list; a hash map covers
/// the case of a small region inside a very large vertex buffer.
pub(crate) fn compact_region(positions: &[f32], indices: &[u32]) -> (Vec<f32>, Vec<u32>, Vec<u32>) {
    let vertex_count = positions.len() / 3;
    // Region cannot renumber more vertices than corners or mesh
    // contains: both lists start at bound instead of doubling en route.
    let bound = indices.len().min(vertex_count.max(1));
    let mut compact_pos = Vec::with_capacity(bound * 3);
    let mut remap = Vec::with_capacity(bound);
    let mut compact_idx = Vec::with_capacity(indices.len());
    let push = |source: u32, compact_pos: &mut Vec<f32>, remap: &mut Vec<u32>| {
        let i = source as usize * 3;
        if i + 2 < positions.len() {
            compact_pos.extend_from_slice(&positions[i..i + 3]);
        } else {
            compact_pos.extend_from_slice(&[0.0, 0.0, 0.0]);
        }
        remap.push(source);
    };
    if indices.len() * 4 >= vertex_count {
        let mut table = vec![u32::MAX; vertex_count];
        for &source in indices {
            let slot = table.get_mut(source as usize);
            let id = match slot {
                Some(entry) if *entry != u32::MAX => *entry,
                Some(entry) => {
                    let id = remap.len() as u32;
                    *entry = id;
                    push(source, &mut compact_pos, &mut remap);
                    id
                }
                None => {
                    let id = remap.len() as u32;
                    push(source, &mut compact_pos, &mut remap);
                    id
                }
            };
            compact_idx.push(id);
        }
    } else {
        let mut map = HashMap::with_capacity(indices.len());
        for &source in indices {
            let id = match map.get(&source) {
                Some(&id) => id,
                None => {
                    let id = remap.len() as u32;
                    map.insert(source, id);
                    push(source, &mut compact_pos, &mut remap);
                    id
                }
            };
            compact_idx.push(id);
        }
    }
    (compact_pos, compact_idx, remap)
}
/// meshoptimizer's per-vertex flags (`meshopt_SimplifyVertex_*`): the vertex does not move.
pub const VERTEX_LOCK: u8 = 1;
/// The vertex keeps its attribute discontinuity (a texture seam) under permissive mode.
pub const VERTEX_PROTECT: u8 = 2;

/// One per-vertex attribute counted in the simplification error: `width` floats per source
/// vertex, each weighted by `weight` against the positions normalised to the region's extent.
pub struct Attribute<'a> {
    pub values: &'a [f32],
    pub width: usize,
    pub weight: f32,
}

/// Simplify a region with an explicit per-vertex flag table instead of a blanket border lock.
/// `flags` is queried with source vertex indices and answers `VERTEX_LOCK` and `VERTEX_PROTECT`.
/// A vertex that no other region shares stays free, so the open boundary of a primitive keeps
/// simplifying instead of pinning the whole region.
///
/// The reference's options (meshoptimizer `clusterlod.h`): the error is absolute, `attributes`
/// count in it, and permissive mode lets a collapse cross an attribute discontinuity — a hard
/// edge — unless the vertex is protected. `prune` also removes the disconnected parts that fall
/// under the error; it ignores locks, so a caller that must keep a locked vertex turns it off.
/// The error is clamped to the region's extent: the attribute share never outweighs the geometry
/// it sits on, as the reference's `simplify_error_clamped`.
pub fn simplify_with_locked_vertices(
    positions: &[f32],
    attributes: &[Attribute],
    indices: &[u32],
    target_triangles: usize,
    prune: bool,
    flags: &dyn Fn(u32) -> u8,
) -> Result<SimplifiedMesh> {
    if indices.len() < 3 || !indices.len().is_multiple_of(3) {
        return Err(invalid("Index count must be a positive multiple of three"));
    }
    if !positions.len().is_multiple_of(3) {
        return Err(invalid("POSITION count must be a multiple of three"));
    }
    let current = indices.len() / 3;
    if current <= target_triangles.max(1) {
        return Ok(SimplifiedMesh {
            indices: indices.to_vec(),
            error_object: 0.0,
            triangles: current,
        });
    }
    let (compact_pos, compact_idx, remap) = compact_region(positions, indices);
    let flags: Vec<u8> = remap.iter().map(|&source| flags(source)).collect();
    let (values, weights) = compact_attributes(attributes, &remap);
    let bytes = unsafe {
        std::slice::from_raw_parts(compact_pos.as_ptr() as *const u8, compact_pos.len() * 4)
    };
    let vertices = VertexDataAdapter::new(bytes, 12, 0).map_err(|_| invalid("POSITION adapter"))?;
    let mut options = SimplifyOptions::ErrorAbsolute | SimplifyOptions::Permissive;
    if prune {
        options |= SimplifyOptions::Prune;
    }
    let mut out = vec![0u32; compact_idx.len()];
    let mut result_error = 0.0_f32;
    // The crate's wrapper takes the flags as `bool`, which cannot carry `VERTEX_PROTECT`.
    let count = unsafe {
        meshopt::ffi::meshopt_simplifyWithAttributes(
            out.as_mut_ptr(),
            compact_idx.as_ptr(),
            compact_idx.len(),
            compact_pos.as_ptr(),
            remap.len(),
            12,
            values.as_ptr(),
            weights.len() * 4,
            weights.as_ptr(),
            weights.len(),
            flags.as_ptr(),
            target_triangles.max(1) * 3,
            f32::MAX,
            options.bits(),
            &mut result_error,
        )
    };
    out.truncate(count);
    let triangles = out.len() / 3;
    if triangles >= current || out.is_empty() {
        return Ok(SimplifiedMesh {
            indices: indices.to_vec(),
            triangles: current,
            error_object: 0.0,
        });
    }
    let extent = meshopt::simplify::simplify_scale(&vertices) as f64;
    Ok(SimplifiedMesh {
        indices: out.into_iter().map(|i| remap[i as usize]).collect(),
        triangles,
        error_object: (result_error as f64).min(extent),
    })
}

/// The attributes of the region's vertices, interleaved in compact order, and one weight per float.
fn compact_attributes(attributes: &[Attribute], remap: &[u32]) -> (Vec<f32>, Vec<f32>) {
    let weights: Vec<f32> = attributes
        .iter()
        .flat_map(|a| std::iter::repeat_n(a.weight, a.width))
        .collect();
    let mut values = Vec::with_capacity(remap.len() * weights.len());
    for &source in remap {
        for a in attributes {
            let i = source as usize * a.width;
            match a.values.get(i..i + a.width) {
                Some(v) => values.extend_from_slice(v),
                None => values.extend(std::iter::repeat_n(0.0, a.width)),
            }
        }
    }
    (values, weights)
}
#[cfg(test)]
#[path = "qem_attribute_tests.rs"]
mod attribute_tests;
#[cfg(test)]
#[path = "qem_tests.rs"]
mod tests;

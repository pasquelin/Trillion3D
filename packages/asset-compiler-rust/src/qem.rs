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
/// Simplify a region with an explicit per-vertex lock table instead of a blanket border lock.
/// `locked` is queried with source vertex indices. A vertex that no other region shares stays free,
/// so the open boundary of a primitive keeps simplifying instead of pinning the whole region.
pub fn simplify_with_locked_vertices(
    positions: &[f32],
    indices: &[u32],
    target_triangles: usize,
    target_error: f32,
    locked: &dyn Fn(u32) -> bool,
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
    let locks: Vec<bool> = remap.iter().map(|&source| locked(source)).collect();
    let bytes = unsafe {
        std::slice::from_raw_parts(compact_pos.as_ptr() as *const u8, compact_pos.len() * 4)
    };
    let vertices = VertexDataAdapter::new(bytes, 12, 0).map_err(|_| invalid("POSITION adapter"))?;
    let mut result_error = 0.0_f32;
    let out = meshopt::simplify::simplify_with_locks(
        &compact_idx,
        &vertices,
        &locks,
        (target_triangles.max(1)) * 3,
        target_error,
        SimplifyOptions::None,
        Some(&mut result_error),
    );
    let triangles = out.len() / 3;
    let progressed = triangles < current && !out.is_empty();
    let scale = meshopt::simplify::simplify_scale(&vertices) as f64;
    let mapped = if progressed {
        out.into_iter()
            .map(|i| remap.get(i as usize).copied().unwrap_or(i))
            .collect()
    } else {
        indices.to_vec()
    };
    Ok(SimplifiedMesh {
        indices: mapped,
        triangles: if progressed { triangles } else { current },
        error_object: if progressed {
            (result_error as f64) * scale
        } else {
            0.0
        },
    })
}
#[cfg(test)]
#[path = "qem_tests.rs"]
mod tests;

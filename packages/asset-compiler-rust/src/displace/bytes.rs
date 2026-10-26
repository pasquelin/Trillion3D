//! What baking a displacement holds, from the structures it allocates (`mesh.rs`, `tessellate.rs`,
//! `bake.rs`): the model a primitive that bakes is charged by (`compiler/primitive/cost.rs`). The
//! tessellation makes up to its cap whatever the maps hold, the cap the job's room allows
//! (`cost::bake_cap`, at most `MAX_TRIANGLES`), so a primitive that names one is charged for them.
use super::tessellate::Record;
use std::mem::size_of;

/// The most triangles and vertices a mesh of `triangles` triangles over `vertices` vertices has
/// once baked under the cap `cap`: a mesh that begins at the cap is not tessellated; each triangle a
/// split adds brings at most half a vertex — a poke one vertex for two triangles, an edge one or
/// two for two or four.
pub(crate) fn most_after(triangles: usize, vertices: usize, cap: usize) -> Option<(usize, usize)> {
    let most = triangles.max(cap);
    Some((most, vertices.checked_add(most / 2)?))
}

/// A hash-map entry costs at most 16/7 of its pair: 7/16 is hashbrown's lowest load after growth.
pub(crate) const fn hashed(pair: usize) -> usize {
    pair * 16 / 7
}

/// Bytes the tessellation of `triangles` triangles over `vertices` vertices of `floats` attribute
/// floats beside the position holds at its peak, where it ends (`Tessellation::finish`): per
/// triangle the corners, the half edges across them, the material, the record and the queues; per
/// vertex the row, its displacement, and the map and sums that join the vertices of one position.
/// The lists that grow by pushes are counted twice, a vector's capacity at most twice its length.
pub(crate) fn soup_bytes(triangles: usize, vertices: usize, floats: usize) -> Option<usize> {
    let triangle = 2
        * (3 * size_of::<u32>() + 3 * size_of::<i32>() + size_of::<i32>() + size_of::<Record>())
        + 2 * size_of::<u32>();
    let vertex = 2 * (3 + floats) * size_of::<f32>()
        + 2 * size_of::<[f32; 3]>()
        + hashed(size_of::<([u32; 3], usize)>())
        + size_of::<([f32; 3], u32)>()
        + size_of::<usize>();
    triangles
        .checked_mul(triangle)?
        .checked_add(vertices.checked_mul(vertex)?)
}

/// Bytes of the baked mesh's arrays: the corners of its triangles, the position and the attributes
/// of its vertices — held while its build runs.
pub(crate) fn baked_bytes(triangles: usize, vertices: usize, floats: usize) -> Option<usize> {
    triangles
        .checked_mul(3 * size_of::<u32>())?
        .checked_add(vertices.checked_mul((3 + floats) * size_of::<f32>())?)
}

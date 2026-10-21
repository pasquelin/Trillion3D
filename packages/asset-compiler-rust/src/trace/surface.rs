//! A source mesh traced on the CPU: its level-0 triangles with their materials, texture
//! coordinates and normals (`mesh.rs`, `read.rs`), each hit reading its material's filtered texels
//! (`material.rs`). The voxels are sampled through it (`voxel`); the HLOD actors' flattened
//! materials read the same triangles and materials, packed for the GPU (`../hlod/flatten/bake`).
pub(crate) mod material;
pub(crate) mod mesh;
mod read;
#[cfg(test)]
mod tests;

pub(crate) use mesh::Traceable;

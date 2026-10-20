//! A source mesh traced on the CPU: its level-0 triangles with their materials, texture
//! coordinates and normals (`mesh.rs`, `read.rs`), each hit reading its material's filtered texels
//! (`surface.rs`), and a sample averaged over several rays (`sampler.rs`). The voxel faces are
//! sampled through it (`voxel`), and so are the HLOD actors' flattened materials
//! (`compiler_world_roots/flatten`).
pub(crate) mod mesh;
mod read;
mod sampler;
pub(crate) mod surface;
#[cfg(test)]
mod tests;

pub(crate) use mesh::Traceable;
pub(crate) use sampler::{parted, rays, texel, SUBSAMPLES};

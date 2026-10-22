//! The flattened actor's texture space: unique coordinates cut into charts grown by cost
//! (`charts`), unwrapped by patches or by spectral charts (`unwrap`) or laid out again from the
//! mesh's own first set (`legacy`), the islands packed into the atlas (`pack`), the atlas's texel
//! occupancy (`raster`).
pub(crate) mod charts;
pub(crate) mod extremes;
pub(crate) mod legacy;
pub(crate) mod pack;
pub(crate) mod raster;
pub(crate) mod spectral;
pub(crate) mod unwrap;

/// A mesh's topology, what both unwraps read: welded positions and triangles.
pub(crate) struct Topology<'a> {
    pub points: &'a [[f64; 3]],
    pub triangles: &'a [[usize; 3]],
}

//! THE TRIANGLE CLUSTERER, one for the compiler's DAG levels and for the cuts the world makes at
//! run time (`wasm_clusters.rs`, in the page worker): indexed triangles in, clusters of at most
//! `Caps` out, by one of two rules.
//!
//! - `spatial` (`spatial.rs`): a recursive bisection of the triangles' centres on the axis of least
//!   cost, into as few clusters as the caps allow, each one compact: what a cooked mesh and an
//!   opaque cut take, whatever their index order.
//! - `ordered` (`ordered.rs`): consecutive triangles in source order, the paint order of a blended
//!   surface and the coplanar layer of lines and sprites, a run ending where a cap would be passed
//!   or, on held faces, where the run would reach past a compact cluster of its triangles.
pub mod ordered;
pub mod spatial;

use trillion3d_math::vec3::point_checked;

/// Vertex `v` of a stream of three `f32` a vertex, as `f64`; NaN past the end, which no box keeps
/// and no area or length survives.
fn point(positions: &[f32], v: u32) -> [f64; 3] {
    point_checked(positions, v).unwrap_or([f64::NAN; 3])
}

/// The most triangles and distinct vertices one cluster holds: the compiler's
/// `DAG_CLUSTER_TRIANGLES` and `DAG_CLUSTER_VERTICES`, which the run-time cut reads too.
#[derive(Clone, Copy, Debug)]
pub struct Caps {
    pub triangles: usize,
    pub vertices: usize,
}

#[cfg(test)]
#[path = "clusters_tests.rs"]
mod tests;

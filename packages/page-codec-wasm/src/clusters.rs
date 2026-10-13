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

//! What the compiler learns of a primitive's deformation beyond the page's streams
//! (`trillion3d_page_codec::encode::deformation`): the reach it publishes and the soft body a node
//! declares.
mod reach;
mod soft;
pub use reach::reach_for_pass;
pub use soft::declare_soft;
#[cfg(test)]
#[path = "geometry_page_deform_tests.rs"]
mod tests;

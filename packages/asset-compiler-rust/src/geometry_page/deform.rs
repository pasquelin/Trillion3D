//! What the compiler learns of a primitive's deformation beyond the page's streams
//! (`trillion3d_page_codec::encode::deformation`): the reach it publishes and the soft body a node
//! declares.
pub(crate) mod reach;
mod soft;
#[cfg(test)]
pub(crate) mod tests;
pub use reach::reach;
pub use soft::declare_soft;

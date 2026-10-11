//! The page encoder (`trillion3d_page_codec::encode`) driven through the compiler: what it writes
//! the shared decoder reads back, on the grids the compiler gives a primitive.

#[path = "geometry_page_batch_b_tests.rs"]
mod batch_b;

#[path = "geometry_page_codec_tests.rs"]
pub(crate) mod codec;

#[path = "geometry_page_codec_refusal_tests.rs"]
mod codec_refusal;

#[path = "geometry_page_grid_tests.rs"]
mod grid;

#[path = "geometry_page_positions_tests.rs"]
mod positions;

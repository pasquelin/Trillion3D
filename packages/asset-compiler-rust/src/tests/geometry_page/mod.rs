//! The page encoder (`trillion3d_page_codec::encode`) driven through the compiler: what it writes
//! the shared decoder reads back, on the grids the compiler gives a primitive.

mod batch_b;
pub(crate) mod codec;
mod codec_refusal;
mod grid;
mod positions;

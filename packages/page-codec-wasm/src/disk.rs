//! The page on disk (`VERSION`): the header words of the resident page, twelve words naming what
//! the page stores and where, the code of its strips, the vertices it names, then the planes of
//! the fields of the vertices it stores and the raw words of its skin and morph targets.
//!
//! **Order.** In bytes from the page's first: the header words and the morph records; the
//! `DISK_HEADER_WORDS` words (`DiskLayout::words`); the masks of the strips, three words for each
//! 32 triangles, for the most a page holds (`MASK_GROUPS`); their distances, five bits each; the
//! pairs of clusters the page names vertices of; one bit a vertex, set for a vertex it names; the
//! vertices it names, each the rank of its pair and the index of the vertex in that cluster
//! (`refs.rs`); the three byte planes; the raw words.
//!
//! **The fields.** Every field of a vertex the page stores — all but those it names — is coded as
//! the difference to the field before it in its stream, as a stream of deltas: the delta wrapped to
//! the field's own width (`shortest_wrap`, the shortest way round the field's cells), its sign
//! folded into its low bit (`encode_zigzag`, 0, -1, 1, -2 to 0, 1, 2, 3), its bytes spread over three
//! planes — the low byte of every value in the first, the middle byte in the second, the high byte
//! in the third; a value of one byte is in the first plane alone. A stream's components lie
//! together per field, `x, y, z, x, y, z`; its streams one after the other in each plane, in the
//! order of `runs`: the links of every vertex, then the positions, the normals, the tangents, the
//! colours, the texture sets of the vertices stored. A running sum of the deltas, masked to the
//! field's width, gives the field back (`get`); the first delta is counted from the middle of the
//! position cells and from zero for the others (`Run::start`).
//!
//! The install pass reads this page and writes the resident page (`resident.rs`) the shaders read,
//! the vertices it stores first, those it names after the clusters they name are installed. It
//! trusts the gate (`read_raw`): the sizes the counts make are the page's, the strips lay exactly
//! the vertices of the page and name only vertices laid, every corner names a vertex of the page,
//! every link a stored position, and the corner stream's bits are the header's.

use crate::attributes::UV_FLAGS;
use crate::bits::{le_words, stream_words, BitReader};
use crate::clusters::strip::{unpack, Strip, MASK_GROUPS};
use crate::encode::cells::Cell;
use crate::refs::{Refs, Resident, Vertex};
use crate::streams::{Page, Part, Streams};
use crate::triangles::{Spans, MAX_WIDTH};
use crate::writer::BitWriter;
use crate::{
    deform, Header, Layout, PageError, DISK_HEADER_WORDS, FLAG_COLOR, FLAG_NORMAL, FLAG_TANGENT,
    MAX_PAGE_CORNERS, MAX_PAGE_VERTICES, SELF_PLACE, STRIP_REF_BITS, VERSION,
};

mod layout;
mod open;
mod read;
mod write;

pub use layout::*;
pub use open::*;
pub use read::*;
pub use write::*;

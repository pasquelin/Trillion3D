//! Vertex references: the vertices a cluster's page shares with others are named, not stored.
//!
//! A vertex of a page is named when another cluster already holds a vertex that quantizes alike on
//! the same grids (`Vertex`, compared whole): in a cluster of a streaming page this page depends
//! on, in an earlier cluster of its own streaming page that stores it, or earlier in the very page
//! (a vertex a strip laid twice). The page then stores, for that vertex, no field — only where to
//! find it: the pair of the cluster (`REF_PLACE_BITS`: the rank of its streaming page in this
//! page's list of dependencies, 0 for its own, above the place of the cluster there, in words
//! from the start of the streaming page's place in the pool) and the vertex's index in that
//! cluster. The install pass writes the vertices a page stores first, then, once the clusters they
//! name are installed, copies the vertices it names from them, each field moved to this page's
//! own range and width.
//!
//! **The order of the search**, for each vertex of the page in turn: the clusters of the streaming
//! pages the page depends on, in the order of its list, a vertex any of their clusters holds,
//! stored or named; else the vertices the page's streaming page stores, those of its earlier
//! clusters, then the page's own earlier ones; else the vertex is stored, and found by the
//! vertices after it.
//!
//! **Who may name.** A page names a streaming page's vertices only when the compiler marks that
//! page `relative` (`asset-compiler-rust/src/compiler/pages/bundles/relative.rs`): a chain of
//! pages each naming vertices of the one before it would be installed one at a time, so every
//! `MAX_RELATIVE_CHAIN` pages a page stores its vertices instead, and a root page — always
//! resident, a root of the chains — never names another page's.

use crate::attributes::{UV_FLAGS, UV_MASK};
use crate::bits::{le_words, BitReader};
use crate::disk;
use crate::encode::cells::Cell;
use crate::hash::{word_map, WordHasher, WordMap};
use crate::streams::Page;
use crate::{
    Header, Layout, PageError, FLAG_COLOR, FLAG_NORMAL, FLAG_TANGENT, MAX_PAGE_VERTICES, NO_UNIT,
    REF_PLACE_BITS, RESIDENT_VERSION, SELF_PLACE,
};
use core::hash::Hasher;

/// The most streaming pages in a chain of pages naming vertices of the page before them: the page
/// that would make a longer one stores its vertices.
pub const MAX_RELATIVE_CHAIN: u32 = 6;

mod resident;
mod search;
mod vertex;

pub use resident::*;
pub use search::*;
pub use vertex::*;

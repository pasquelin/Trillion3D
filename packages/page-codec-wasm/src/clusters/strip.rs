//! The strips a cluster's triangles are laid in at encode, the halving of a cluster whose strips
//! lay more vertices than a page holds (`constrained`), the code a page carries its triangles by
//! (`Strip`, `strips_in_order`) and the unpacking of that code (`unpack`).
//!
//! **The window.** A strip names a vertex it reuses by how far back among the vertices laid so far
//! it was laid, `WINDOW − 1` at most: a vertex further back is laid again, so a vertex can be laid
//! twice and the vertices laid can outnumber the cluster's.
//!
//! **Laying** (`lay`). A triangle's neighbour across an edge is a triangle running that edge back
//! between the same two vertices, the last listed first. A strip starts, over every triangle still
//! to lay in index order and its three corners in order, at the corner whose vertices — the
//! corner after it, the corner before it, then the corner itself — would lay new vertices only at
//! the end, of the best score: the window's score of the triangle's three vertices (`WEIGHTS`, by
//! whether the triangle starts a strip, whether its neighbours across the corner's three edges are
//! still to lay, and how far back each vertex lies), a tie going to the greater sum of the
//! corners' x than the last tie kept. The strip then grows to the neighbour across the edge of the
//! corner after its last corner, or across the edge of the corner before it when that one is still
//! to lay and scores more, until neither is left, the triangles laid reach a multiple of 32, or the
//! two vertices it shares would leave the window; never to nor from a triangle that names a vertex
//! twice, which the code has no place for. A laid triangle starts at the corner after its
//! entry corner, or, grown across the edge of the corner after the last one, at the corner before
//! its entry: its winding kept.
//!
//! **The cap.** A cluster whose strips lay more vertices than the cap is cut after the first half
//! of its laid triangles, and each half is laid again as the first laying named it, a vertex laid
//! twice there two vertices.
//!
//! **The code** (`Strip`). Every triangle laid is a start or a growth, left or right, and lays new
//! vertices or names vertices laid before: three bits a triangle — start, left, with a vertex
//! named (`Strip::masks`: S, L and W) —, and for each vertex named, how far back it was laid, five
//! bits (`Strip::refs`). A start names 0 to 3 vertices, its L and W bits their count, and lays
//! the others after them; a growth names at most its third vertex, the other two being the edge
//! it grew across. `unpack` reads the triangles back from the code and the counts alone.
//!
//! **In order** (`strips_in_order`). A cluster that must keep its triangle order (a blended
//! surface, a layer of lines) is laid by the same rules with the starts given by that order: a
//! triangle grows the strip only if it is the one the strip would grow to, else it starts one. A
//! cluster that `constrained` laid is laid again as it was.
use crate::edges::DirectedEdges;
use crate::encode::vertices::first_use;
use crate::{MAX_PAGE_TRIANGLES, STRIP_REF_BITS, STRIP_WINDOW};
use trillion3d_math::geometry::triangle::{next_corner as next, prev_corner as prev};
use trillion3d_math::vector::vec3::point_checked_f32;

mod weights;

use weights::{row, WEIGHTS};

/// How far back, in laid vertices, a strip names a vertex it reuses, plus one.
const WINDOW: u32 = STRIP_WINDOW;
/// No vertex laid, no corner.
const NONE: u32 = 0xFFFF;
/// The triangles a strip runs at most before it starts again: the laid count's period.
const RUN: usize = 32;
/// Triangles a word of a mask holds.
const PER_WORD: usize = 32;
/// The groups of 32 triangles whose masks every page carries, whatever its triangles: those of the
/// most a page holds, the bits past its last triangle zero.
pub const MASK_GROUPS: usize = MAX_PAGE_TRIANGLES / PER_WORD;
/// The mask of a distance: `STRIP_REF_BITS` bits.
const REF_MASK: u32 = (1 << STRIP_REF_BITS) - 1;

/// A cluster laid in strips: its triangles in strip order, and, its strips laying more vertices
/// than the cap, its second half laid on its own.
pub struct Laid {
    pub first: Vec<u32>,
    pub second: Option<Vec<u32>>,
}

/// The code of a cluster's triangles laid in strips (the module's code): the S, L and W bits of
/// every 32 triangles, the distance of each vertex named, and the two words of counts that let a
/// reader find a triangle's place in the code without reading those before it.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Strip {
    /// Per 32 triangles, the start, left and with-a-vertex-named bits, one bit a triangle.
    pub masks: Vec<[u32; 3]>,
    /// For each vertex named, in triangle order, how far back among the vertices laid it was.
    pub refs: Vec<u32>,
    /// The vertices laid, and those named, by the triangles of the first three words of 32, ten
    /// bits each, the first word's total lowest: the counts before the second, third and fourth word.
    pub laid_before: u32,
    pub named_before: u32,
}

impl Strip {
    /// Whether the masks are as the code writes them: `MASK_GROUPS` of them, no bit set for a
    /// triangle past the first `triangles`.
    pub fn is_clean(&self, triangles: usize) -> bool {
        self.masks.len() == MASK_GROUPS
            && self.masks.iter().enumerate().all(|(word, mask)| {
                let held = triangles.saturating_sub(word * PER_WORD).min(PER_WORD);
                let valid = if held >= PER_WORD {
                    u32::MAX
                } else {
                    (1u32 << held) - 1
                };
                mask.iter().all(|&bits| bits & !valid == 0)
            })
    }

    /// The vertices the triangles lay, and those they name, counted off the masks of `triangles`
    /// triangles alone.
    pub fn totals(&self, triangles: usize) -> (usize, usize) {
        let (mut laid, mut named) = (0usize, 0usize);
        for (word, mask) in self.masks.iter().enumerate() {
            let held = triangles.saturating_sub(word * PER_WORD).min(PER_WORD);
            let (l, n) = counts_of(*mask, held);
            laid += l as usize;
            named += n as usize;
        }
        (laid, named)
    }

    /// The two count words the masks make of `triangles` triangles, as `packed_counts` packs them
    /// (`laid_before`, `named_before`).
    pub fn packed_counts(&self, triangles: usize) -> (u32, u32) {
        let (mut laid, mut named) = ([0u32; 3], [0u32; 3]);
        for word in 0..3 {
            let mask = self.masks.get(word).copied().unwrap_or([0; 3]);
            let held = triangles.saturating_sub(word * PER_WORD).min(PER_WORD);
            let (l, n) = counts_of(mask, held);
            laid[word] = l + if word > 0 { laid[word - 1] } else { 0 };
            named[word] = n + if word > 0 { named[word - 1] } else { 0 };
        }
        let pack = |c: [u32; 3]| c[0] | c[1] << 10 | c[2] << 20;
        (pack(laid), pack(named))
    }
}

/// The vertices laid and the vertices named by the first `held` triangles of a word of masks.
fn counts_of(mask: [u32; 3], held: usize) -> (u32, u32) {
    let valid = if held >= PER_WORD {
        u32::MAX
    } else {
        (1u32 << held) - 1
    };
    let [s, l, w] = mask.map(|m| m & valid);
    // A start names its L and W bits as a number (three, two, one or none); a growth names its W.
    let named = 2 * (s & l).count_ones() + w.count_ones();
    // A start lays 3 less those it names; a growth lays 1 less than it names.
    let starts = s.count_ones();
    let growths = held as u32 - starts;
    (starts * 3 + growths - named, named)
}

/// A triangle list laid in strips in the order given: `triangles`, three laid indices each, the
/// vertex each laid index is among those given, and the code.
pub struct Strips {
    pub triangles: Vec<u32>,
    pub laid: Vec<u32>,
    pub strip: Strip,
}

/// The triangles of `cluster` over `positions` laid in strips, halved when they lay more vertices
/// than `cap` (the module's rule).
pub fn constrained(positions: &[f32], cluster: &[u32], cap: usize) -> Laid {
    let point = |v: u32| point_checked_f32(positions, v as usize).unwrap_or([f32::NAN; 3]);
    let triangles = cluster.as_chunks::<3>().0;
    let whole = lay(triangles, Order::Scored(&point));
    let itself = |v: u32| v;
    if whole.laid.len() <= cap {
        return Laid {
            first: whole.flat(&itself),
            second: None,
        };
    }
    let source = |laid: u32| whole.laid[laid as usize];
    let point_of = |laid: u32| point(source(laid));
    let half = triangles.len() / 2;
    let first = lay(&whole.triangles[..half], Order::Scored(&point_of));
    let second = lay(&whole.triangles[half..], Order::Scored(&point_of));
    Laid {
        first: first.flat(&source),
        second: Some(second.flat(&source)),
    }
}

/// The triangles `triangles` (three vertices each, any ids) laid in strips in the order given,
/// every triangle the next one laid, as a strip grows to it or starts at it: the triangles keep
/// their order and their winding, each in the rotation its strip unpacks it in (`unpack`, the one
/// reading of the code, which the page's corners are). A list `constrained` laid is laid again
/// as `constrained` laid it, strip for strip.
pub fn strips_in_order(triangles: &[u32]) -> Strips {
    let laid = lay(triangles.as_chunks::<3>().0, Order::Given);
    Strips {
        triangles: unpack(&laid.strip, triangles.len() / 3),
        laid: laid.laid,
        strip: laid.strip,
    }
}

/// The vertices `triangles` lay in strips in the order given (`strips_in_order`).
pub fn laid_in_order(triangles: &[u32]) -> usize {
    lay(triangles.as_chunks::<3>().0, Order::Given).laid.len()
}

mod laying;
mod order;
mod unpacking;

use laying::*;
use order::*;
pub use unpacking::*;

//! The resident page (`RESIDENT_VERSION`): the layout the shaders read in place and the install
//! pass writes into the pool — the header words, the morph records and the extension, the table of
//! the streams' offsets (`Layout::table`), the block table and the corner stream, then every
//! other stream as fields of its own width, each stream closed on a word, the skin's and the morph
//! targets' words last (`attributes.rs`, `Layout`).
//!
//! `expand` is the CPU twin of the install pass (`sdk-browser/src/geometry/pages/install`): the
//! page on disk read (`disk::read`), the vertices it names found in the resident pages of the
//! clusters it names them in, and laid out here, the very bytes the pass writes on the GPU, which
//! the tests compare it to.

use crate::attributes::UV_FLAGS;
use crate::disk;
use crate::streams::Streams;
use crate::triangles::Spans;
use crate::writer::BitWriter;
use crate::{Header, Layout, PageError, FLAG_COLOR, FLAG_NORMAL, FLAG_TANGENT, RESIDENT_VERSION};

/// The resident page of header `h` and values `s`.
pub fn write(h: &Header, s: &Streams) -> Vec<u8> {
    let layout = Layout::of(h);
    let mut out = BitWriter::default();
    Spans::of(&s.corners).write(&mut out, &s.corners, &layout.corners);
    for c in 0..3 {
        out.stream(s.position[c].iter().copied(), h.position.bits[c]);
    }
    if h.links_positions() {
        out.stream(s.links.iter().copied(), h.link_bits());
    }
    if h.flags & FLAG_NORMAL != 0 {
        for c in 0..2 {
            out.stream(s.normal[c].iter().copied(), h.normal_precision);
        }
    }
    for (set, flag) in UV_FLAGS.into_iter().enumerate() {
        if h.flags & flag != 0 {
            for c in 0..2 {
                out.stream(s.uv[set][c].iter().copied(), h.uv[set].bits[c]);
            }
        }
    }
    if h.flags & FLAG_COLOR != 0 {
        for c in 0..4 {
            out.stream(s.color[c].iter().copied(), h.color.bits[c]);
        }
    }
    if h.flags & FLAG_TANGENT != 0 {
        out.stream(s.tangent.iter().copied(), h.tangent_precision + 1);
    }
    let words = (h.words(RESIDENT_VERSION).into_iter())
        .chain(out.words().iter().copied())
        .chain(s.deform.iter().copied());
    let bytes: Vec<u8> = words.flat_map(u32::to_le_bytes).collect();
    debug_assert_eq!(bytes.len(), layout.bytes());
    bytes
}

/// The page on disk `data`, gated (`disk::read`), the vertices it names found in `referenced`
/// (the resident page of each pair's cluster, in the order of the pairs), and laid out as the
/// resident page.
pub fn expand(
    data: &[u8],
    max_decoded_bytes: usize,
    referenced: &[&[u8]],
) -> Result<Vec<u8>, PageError> {
    let page = disk::read(data, max_decoded_bytes, referenced)?;
    Ok(write(&page.header, &page.streams))
}

/// `expand`, the clusters its pairs name found in `pool` as the install pass finds them
/// (`disk::read_in`).
pub fn expand_in(
    data: &[u8],
    max_decoded_bytes: usize,
    pool: (&[u8], &[u32]),
) -> Result<Vec<u8>, PageError> {
    let page = disk::read_in(data, max_decoded_bytes, pool)?;
    Ok(write(&page.header, &page.streams))
}

/// The gate of a resident page, as the shaders that read it in place rely on it: what the tests
/// prove the install pass's pages and the resident decoder by.
#[cfg(test)]
mod gate {
    use crate::bits::le_words;
    use crate::{
        deform, positions, triangles, Header, Layout, PageError, MAX_VERTICES, RESIDENT_VERSION,
    };

    impl Header {
        /// The resident page, gated: the header's bounds, the byte length exactly what the streams
        /// need and the decoded page under the budget, every corner record within its stream and
        /// every link naming a stored position.
        pub fn parse_resident(data: &[u8], max_decoded_bytes: usize) -> Result<Self, PageError> {
            let header = Self::read_words(data, RESIDENT_VERSION)?;
            let layout = Layout::of(&header);
            let (table, v, n) = (
                layout.triangles[1] * 4,
                header.vertex_count,
                header.index_count,
            );
            let sane = header.fields_sane()
                && (1..=MAX_VERTICES).contains(&header.vertex_count)
                && (1..=header.vertex_count).contains(&header.position_count)
                && (3..=max_decoded_bytes / 4).contains(&header.index_count)
                && header.index_count.is_multiple_of(3)
                && header.corner_bits <= header.index_count.saturating_mul(triangles::MAX_WIDTH)
                && header.decoded_bytes() <= max_decoded_bytes
                && layout.bytes() == data.len()
                && le_words(&data[header.bytes()..header.body_at()]).eq(layout.table())
                && layout.morphs_at(&header)
                && deform::finite(
                    &le_words(&data[header.body_at() + layout.skin * 4..]).collect::<Vec<_>>(),
                    &header,
                    &layout,
                )
                && layout
                    .corners
                    .fits(&data[header.body_at()..][..table], v, n)
                && positions::links_fit(&data[header.body_at()..], &layout, &header);
            if !sane {
                return Err(PageError::Bounds);
            }
            Ok(header)
        }
    }
}

//! The page on disk read and gated: the planes read back to the page's fields.

use super::*;

/// One run's values back from the planes, `cursor` the next byte of each plane.
pub(super) fn get(run: &Run, planes: [&[u8]; 3], cursor: &mut [usize; 3], into: &mut [Vec<u32>]) {
    let mut sum = run.start;
    for values in into.iter_mut() {
        values.reserve(run.count);
    }
    for _ in 0..run.count {
        for (c, values) in into.iter_mut().enumerate() {
            let mut code = 0u32;
            for plane in 0..run.bytes {
                code |= u32::from(planes[plane][cursor[plane]]) << (8 * plane);
                cursor[plane] += 1;
            }
            sum[c] = sum[c].wrapping_add(decode_zigzag(code) as u32);
            values.push(sum[c] & mask(run.bits[c]));
        }
    }
}

/// A page on disk read and gated, the vertices it names not yet found: its header and strips, the
/// cells of the vertices it stores — those it names zero, a named vertex's position excepted when
/// the page stores each once —, its references, its links, the table of its positions when it
/// stores each once, its corners and its raw words.
#[derive(Clone, Debug, PartialEq)]
pub struct Raw {
    pub header: Header,
    pub strip: Strip,
    pub refs: Refs,
    pub cells: Vec<Cell>,
    pub links: Vec<u32>,
    pub table: Option<[Vec<u32>; 3]>,
    pub corners: Vec<u32>,
    pub deform: Vec<u32>,
}

/// The pairs, the vertices named and the bytes of a page on disk, as its header words and the
/// words after them say, checked against one another.
pub(super) fn shape_of(
    data: &[u8],
    header: &Header,
    strip: &Strip,
) -> Result<(Shape, [u32; DISK_HEADER_WORDS]), PageError> {
    let at = header.bytes();
    let words: Vec<u32> = le_words(&data[at..at + 4 * DISK_HEADER_WORDS]).collect();
    let stored: [u32; DISK_HEADER_WORDS] = words.try_into().map_err(|_| PageError::Bounds)?;
    let (_, strip_refs) = strip.totals(header.index_count / 3);
    let shape = Shape {
        strip_refs,
        pairs: stored[1] as usize,
        named: stored[0] as usize,
    };
    Ok((shape, stored))
}

/// The page `data`, gated and its stored fields read: its header is refused unless within the
/// format's bounds, `max_decoded_bytes` holds what it decodes to and its length is what the counts
/// make; its strips unless they lay exactly its vertices and name only vertices laid, its
/// references unless they name a cluster of a pair and a vertex, its corners unless each names a
/// vertex (`PageError::Index`), its links unless each names a stored position, its corner stream
/// unless it takes the bits the header says, its raw floats unless finite.
pub fn read_raw(data: &[u8], max_decoded_bytes: usize) -> Result<Raw, PageError> {
    let header = Header::read_words(data, VERSION)?;
    let n = header.vertex_count;
    let sane = header.fields_sane()
        && (1..=MAX_PAGE_VERTICES).contains(&n)
        && (1..=n).contains(&header.position_count)
        && (3..=MAX_PAGE_CORNERS).contains(&header.index_count)
        && header.index_count.is_multiple_of(3)
        && header.corner_bits <= header.index_count * MAX_WIDTH
        && header.decoded_bytes() <= max_decoded_bytes;
    if !sane {
        return Err(PageError::Bounds);
    }
    let triangles = header.index_count / 3;
    let masks_at = header.bytes() + 4 * DISK_HEADER_WORDS;
    let masks_end = masks_at + 4 * MASK_GROUPS * GROUP_WORDS;
    if data.len() < masks_end {
        return Err(PageError::Bounds);
    }
    let masks: Vec<[u32; 3]> = le_words(&data[masks_at..masks_end])
        .collect::<Vec<_>>()
        .chunks(GROUP_WORDS)
        .map(|m| [m[0], m[1], m[2]])
        .collect();
    let mut strip = Strip {
        masks,
        ..Strip::default()
    };
    // Nothing past the last triangle: its bits are the page's, not the code's.
    if !strip.is_clean(triangles) {
        return Err(PageError::Bounds);
    }
    let (laid, named_total) = strip.totals(triangles);
    if laid != n {
        return Err(PageError::Bounds);
    }
    let (shape, stored) = shape_of(data, &header, &strip)?;
    let sums = strip.packed_counts(triangles);
    (strip.named_before, strip.laid_before) = (sums.1, sums.0);
    if shape.named > n || shape.pairs > 256 || shape.named > 0 && shape.pairs == 0 {
        return Err(PageError::Bounds);
    }
    let layout = DiskLayout::of(&header, shape);
    if layout.bytes != data.len()
        || !layout.resident.morphs_at(&header)
        || stored != layout.words(&strip)
    {
        return Err(PageError::Bounds);
    }
    // The distances of the strips, five bits each.
    let distances: Vec<u32> = le_words(&data[layout.strip_refs_at..layout.pairs_at]).collect();
    strip.refs = {
        let mut reader = BitReader::at(&distances, 0);
        (0..named_total)
            .map(|_| reader.read(STRIP_REF_BITS))
            .collect()
    };
    let corners = unpack(&strip, triangles);
    if corners.iter().any(|&corner| corner as usize >= n) {
        return Err(PageError::Index);
    }
    if Spans::of(&corners).bits != header.corner_bits {
        return Err(PageError::Bounds);
    }
    // The vertices named: a bit each, as many as the header says, none past the vertices.
    let flags: Vec<u32> = le_words(&data[layout.named_at..layout.refs_at]).collect();
    let named: Vec<bool> = (0..n).map(|v| flags[v / 32] >> (v % 32) & 1 != 0).collect();
    let in_last = n % 32;
    if named.iter().filter(|&&is| is).count() != shape.named
        || (in_last != 0 && flags.last().is_some_and(|&last| last >> in_last != 0))
    {
        return Err(PageError::Bounds);
    }
    let pairs: Vec<u32> = le_words(&data[layout.pairs_at..layout.named_at]).collect();
    if pairs.windows(2).any(|two| two[0] >= two[1]) {
        return Err(PageError::Bounds);
    }
    let refs = read_refs(
        &data[layout.refs_at..layout.refs_at + shape.named * 2],
        named,
        pairs,
    )?;
    let planes: [&[u8]; 3] =
        core::array::from_fn(|p| &data[layout.plane_at[p]..][..layout.plane_bytes[p]]);
    let (mut cells, mut cursor) = (vec![Cell::default(); n], [0usize; 3]);
    let (mut links, mut table) = (Vec::new(), [Vec::new(), Vec::new(), Vec::new()]);
    let stored_at: Vec<usize> = (0..n).filter(|&v| !refs.named[v]).collect();
    for run in &layout.runs {
        let mut components = vec![Vec::new(); run.comps];
        get(run, planes, &mut cursor, &mut components);
        match run.part {
            Part::Links => links = components.swap_remove(0),
            Part::Position if header.links_positions() => {
                table = [0, 1, 2].map(|c| core::mem::take(&mut components[c]));
            }
            _ => {
                for (c, values) in components.iter().enumerate() {
                    for (&v, &value) in stored_at.iter().zip(values) {
                        let cell = &mut cells[v];
                        match run.part {
                            Part::Position => cell.position[c] = value,
                            Part::Normal => cell.normal[c] = value,
                            Part::Tangent => cell.tangent = value,
                            Part::Color => cell.color[c] = value,
                            Part::Uv(set) => cell.uv[set][c] = value,
                            Part::Links => {}
                        }
                    }
                }
            }
        }
    }
    let deform: Vec<u32> = le_words(&data[layout.raw_at..]).collect();
    let linked = links
        .iter()
        .all(|&link| (link as usize) < header.position_count);
    if !linked || !deform::finite(&deform, &header, &layout.resident) {
        return Err(PageError::Bounds);
    }
    // A page that stores each position once: every vertex's position is its link's.
    let table = header.links_positions().then_some(table);
    if let Some(table) = &table {
        for (cell, &link) in cells.iter_mut().zip(&links) {
            cell.position = [0, 1, 2].map(|c| table[c][link as usize]);
        }
    }
    Ok(Raw {
        header,
        strip,
        refs,
        cells,
        links,
        table,
        corners,
        deform,
    })
}

/// The vertices named, read from `bytes` — the rank of each one's pair, then each one's index in
/// that cluster, as a running sum of deltas to a byte — beside `named` and the `pairs`.
pub(super) fn read_refs(
    bytes: &[u8],
    named: Vec<bool>,
    pairs: Vec<u32>,
) -> Result<Refs, PageError> {
    let count = bytes.len() / 2;
    let (ranks, deltas) = bytes.split_at(count);
    let mut index = 0u8;
    let mut entries = Vec::with_capacity(count);
    for (&rank, &delta) in ranks.iter().zip(deltas) {
        index = index.wrapping_add(decode_zigzag(u32::from(delta)) as u8);
        if usize::from(rank) >= pairs.len() {
            return Err(PageError::Bounds);
        }
        entries.push((rank, index));
    }
    Ok(Refs {
        named,
        pairs,
        entries,
    })
}

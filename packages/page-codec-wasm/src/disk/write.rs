//! The page on disk written from a page.

use super::*;

/// One run's values, delta by delta, into the planes.
pub(super) fn put(run: &Run, components: &[Vec<u32>], planes: &mut [Vec<u8>; 3]) {
    let mut previous = run.start;
    for field in 0..run.count {
        for (c, values) in components.iter().enumerate() {
            let value = values[field];
            let delta = shortest_wrap(value.wrapping_sub(previous[c]) as i32, run.bits[c]);
            previous[c] = value;
            let code = encode_zigzag(delta);
            for (plane, bytes) in planes.iter_mut().enumerate().take(run.bytes) {
                bytes.push((code >> (8 * plane)) as u8);
            }
        }
    }
}

/// The values of the fields of stream `part`, as the planes hold them: a component each, a value
/// a vertex `named` leaves stored — a position, when the page stores each once, of the whole
/// table.
pub(super) fn stored_values(part: Part, h: &Header, s: &Streams, named: &[bool]) -> Vec<Vec<u32>> {
    let stored = || (0..h.vertex_count).filter(|&v| !named[v]);
    let kept = |all: &[u32]| -> Vec<u32> { stored().map(|v| all[v]).collect() };
    match part {
        Part::Links => vec![s.links.clone()],
        Part::Position if h.links_positions() => s.position.to_vec(),
        Part::Position => s.position.iter().map(|all| kept(all)).collect(),
        Part::Normal => s.normal.iter().map(|all| kept(all)).collect(),
        Part::Tangent => vec![kept(&s.tangent)],
        Part::Color => s.color.iter().map(|all| kept(all)).collect(),
        Part::Uv(set) => s.uv[set].iter().map(|all| kept(all)).collect(),
    }
}

/// The page `p` on disk, naming the vertices `refs` says: exactly what `read` takes back.
pub fn write(p: &Page, refs: &Refs) -> Vec<u8> {
    let (h, s) = (&p.header, &p.streams);
    let shape = Shape {
        strip_refs: p.strip.refs.len(),
        pairs: refs.pairs.len(),
        named: refs.entries.len(),
    };
    let layout = DiskLayout::of(h, shape);
    let mut planes: [Vec<u8>; 3] = Default::default();
    for run in &layout.runs {
        put(
            run,
            &stored_values(run.part, h, s, &refs.named),
            &mut planes,
        );
    }
    let mut words = h.words(VERSION);
    words.extend(layout.words(&p.strip));
    words.extend(p.strip.masks.iter().flatten());
    let mut distances = BitWriter::default();
    for &distance in &p.strip.refs {
        distances.push(distance, STRIP_REF_BITS);
    }
    distances.close();
    words.extend(distances.words());
    words.extend(&refs.pairs);
    let mut named = vec![0u32; stream_words(h.vertex_count, 1)];
    for (v, &is) in refs.named.iter().enumerate() {
        if is {
            named[v / 32] |= 1 << (v % 32);
        }
    }
    words.extend(named);
    let mut bytes: Vec<u8> = words.iter().flat_map(|w| w.to_le_bytes()).collect();
    // Each vertex named: the rank of its pair, then its index in that cluster's, as the delta to
    // the index before it, shortest-wrapped to a byte and zig-zagged.
    bytes.extend(refs.entries.iter().map(|&(pair, _)| pair));
    let mut previous = 0u8;
    for &(_, vertex) in &refs.entries {
        let delta = shortest_wrap(i32::from(vertex.wrapping_sub(previous)), 8);
        bytes.push(encode_zigzag(delta) as u8);
        previous = vertex;
    }
    bytes.resize(closed(bytes.len()), 0);
    for plane in &planes {
        bytes.extend_from_slice(plane);
        bytes.resize(closed(bytes.len()), 0);
    }
    bytes.extend(s.deform.iter().flat_map(|w| w.to_le_bytes()));
    debug_assert_eq!(bytes.len(), layout.bytes);
    bytes
}

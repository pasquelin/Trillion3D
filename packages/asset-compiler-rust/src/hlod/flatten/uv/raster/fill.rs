//! The atlas's holes filled: the image filled and the curve it averages in, eight neighbours, hole
//! infill; the image averaged down; and the dilation every baked atlas fills what holds no value
//! by, outward from what does (`dilate`): an approximated atlas's empty texels where its layer
//! asks for the nearest chart's values (`bake::captured`), a merged atlas's background
//! (`merge/smear.rs`).
use super::{gutter_source, EMPTY, HOLE, SAMPLED};
use crate::texture::{linear_table, linear_to_srgb, srgb_table};
use rayon::prelude::*;
use trillion3d_math::heap::{IndexedHeap, LeastRisingOnTie};
use trillion3d_math::scalar::{mean_f32, unit_to_byte_f32};

/// One RGBA8 image and the curve its colour channels are averaged in: the bytes read through
/// `decode`, written back by `encode`; alpha stays opaque (the infill averages colour only).
pub(crate) struct Image<'a> {
    bytes: &'a mut [u8],
    decode: &'static [f32; 256],
    encode: fn(f32) -> u8,
}

impl<'a> Image<'a> {
    /// A data image, averaged as it is stored.
    pub(crate) fn unit(bytes: &'a mut [u8]) -> Self {
        Self {
            bytes,
            decode: linear_table(),
            encode: unit_to_byte_f32,
        }
    }
    /// A colour image stored in sRGB, averaged in linear.
    pub(crate) fn srgb(bytes: &'a mut [u8]) -> Self {
        Self {
            bytes,
            decode: srgb_table(),
            encode: linear_to_srgb,
        }
    }
    /// Texel `at` set to the mean of texels `from`.
    pub(crate) fn mean(&mut self, at: usize, from: &[usize]) {
        for c in 0..3 {
            let mean = mean_f32(
                from.iter()
                    .map(|&n| self.decode[self.bytes[n * 4 + c] as usize]),
            );
            self.bytes[at * 4 + c] = (self.encode)(mean);
        }
    }
    /// Texel `to` a copy of texel `from`.
    pub(crate) fn copy(&mut self, from: usize, to: usize) {
        self.bytes.copy_within(from * 4..from * 4 + 4, to * 4);
    }
    /// The image, `side` texels square, averaged down `factor` times per side: each texel the
    /// mean of its `factor²` texels in the image's curve, its alpha — one in every image but a
    /// merged atlas's base colour, which holds an opacity or a mask there — in a linear one.
    pub(crate) fn reduced(&self, side: usize, factor: usize) -> Vec<u8> {
        let small = side / factor;
        let mut out = vec![255u8; small * small * 4];
        out.par_chunks_mut(small * 4)
            .enumerate()
            .for_each(|(y, row)| {
                for x in 0..small {
                    let block = (0..factor).flat_map(|dy| {
                        (0..factor).map(move |dx| ((y * factor + dy) * side + x * factor + dx) * 4)
                    });
                    for c in 0..4 {
                        let (decode, encode): (&[f32; 256], fn(f32) -> u8) = match c {
                            3 => (linear_table(), unit_to_byte_f32),
                            _ => (self.decode, self.encode),
                        };
                        let channel = block.clone().map(|at| decode[self.bytes[at + c] as usize]);
                        row[x * 4 + c] = encode(mean_f32(channel));
                    }
                }
            });
        out
    }
}

/// The eight neighbours of texel `at` of an image `width` by `height`, row by row from the top
/// left: a fixed order, so the infill's and the dilation's averages are the same on every run.
fn neighbours8([width, height]: [usize; 2], at: usize) -> impl Iterator<Item = usize> {
    let (x, y) = ((at % width) as i64, (at / width) as i64);
    const OFFSETS: [(i64, i64); 8] = [
        (-1, -1),
        (0, -1),
        (1, -1),
        (-1, 0),
        (1, 0),
        (-1, 1),
        (0, 1),
        (1, 1),
    ];
    OFFSETS.into_iter().filter_map(move |(dx, dy)| {
        let (nx, ny) = (x + dx, y + dy);
        let inside = nx >= 0 && ny >= 0 && nx < width as i64 && ny < height as i64;
        inside.then(|| ny as usize * width + nx as usize)
    })
}

/// What a texel is to `dilate`: holding its value, which the texels around it read (`Source`);
/// holding none, filled from them and read in turn once filled (`Open`); or left as it is, neither
/// read nor filled (`Barred`).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Role {
    Source,
    Open,
    Barred,
}

/// The dilation of an image `sides` texels wide and high, `roles` each texel's (`Role`): ring by
/// ring outward from its sources, each round every open texel beside a source handed to
/// `fill(texel, neighbours)` with those of its eight neighbours holding a value before the round,
/// in `neighbours8`'s order — never none —, so a round's order changes no value. A texel `fill`
/// takes (`true`) is a source from the next round on; one it turns down waits for the next round.
/// The rounds stop when one takes nothing, an open texel no source reaches left as it is. Each
/// open texel so reads the values nearest it: a distance-ordered fill. Holds a role and a mark a
/// texel and its rings, a rank each (18 bytes a texel at most), and per round a byte a texel of
/// its ring.
pub(crate) fn dilate(
    sides: [usize; 2],
    mut roles: Vec<Role>,
    mut fill: impl FnMut(usize, &[usize]) -> bool,
) {
    // Per texel, whether it is listed in the ring being filled or the next.
    let mut listed = vec![false; roles.len()];
    let mut ring: Vec<usize> = (0..roles.len())
        .filter(|&at| {
            roles[at] == Role::Open && neighbours8(sides, at).any(|n| roles[n] == Role::Source)
        })
        .collect();
    ring.iter().for_each(|&at| listed[at] = true);
    let mut from: Vec<usize> = Vec::with_capacity(8);
    while !ring.is_empty() {
        let taken: Vec<bool> = (ring.iter())
            .map(|&at| {
                from.clear();
                from.extend(neighbours8(sides, at).filter(|&n| roles[n] == Role::Source));
                fill(at, &from)
            })
            .collect();
        // A round that took nothing would take nothing again.
        if !taken.contains(&true) {
            break;
        }
        // The next ring: the texels turned down, then the open ones beside a texel taken.
        let mut next: Vec<usize> = Vec::new();
        for (&at, &took) in ring.iter().zip(&taken) {
            match took {
                true => roles[at] = Role::Source,
                false => next.push(at),
            }
        }
        for (&at, _) in ring.iter().zip(&taken).filter(|&(_, &took)| took) {
            for n in neighbours8(sides, at) {
                if roles[n] == Role::Open && !listed[n] {
                    listed[n] = true;
                    next.push(n);
                }
            }
        }
        ring = next;
    }
}

/// The marching infill over the holes of `occupancy`, a `size` square: `fill(hole, neighbours)`
/// for each hole in the order it is filled — fewest missing neighbours first —, with the
/// neighbours it averages. Every texel feeds a hole but those holding the missing value — a hole
/// not filled yet, a gutter texel copied from a hole —: a sampled texel, a filled hole, a gutter
/// texel copied from a sampled one, and an empty texel, its blank value or the nearest chart's
/// (`dilate`). A hole with no valid neighbour when its turn comes is left as it is. The holes wait
/// in an indexed queue, each by the number of its neighbours still missing, inserted in the order
/// of their texels and lowered by one each time a neighbour is filled; equal priorities leave the
/// queue as that queue's rule leaves them (`LeastRisingOnTie`). Per hole it holds its texel, its
/// state and its entry of the queue (`INFILL_HOLE_BYTES`).
pub(crate) fn infill(size: usize, occupancy: &[u32], mut fill: impl FnMut(usize, &[usize])) {
    let sides = [size; 2];
    let feeds = |code: u32| {
        code == SAMPLED
            || code == EMPTY
            || gutter_source(code).is_some_and(|from| occupancy[from] == SAMPLED)
    };
    let holes: Vec<u32> = (0..occupancy.len() as u32)
        .filter(|&at| occupancy[at as usize] == HOLE)
        .collect();
    // Per texel, its rank among the holes; `NONE` for any other texel.
    const NONE: u32 = u32::MAX;
    let mut index = vec![NONE; occupancy.len()];
    for (k, &at) in holes.iter().enumerate() {
        index[at as usize] = k as u32;
    }
    let hole = |n: usize| (index[n] != NONE).then(|| index[n] as usize);
    // Per hole: whether it is filled; one that left the queue unfilled stays missing.
    let mut filled = vec![false; holes.len()];
    let valid = |filled: &[bool], n: usize| match hole(n) {
        Some(k) => filled[k],
        None => feeds(occupancy[n]),
    };
    let mut queue = IndexedHeap::<LeastRisingOnTie>::new(holes.len());
    for (k, &at) in holes.iter().enumerate() {
        let known = (neighbours8(sides, at as usize))
            .filter(|&n| valid(&filled, n))
            .count();
        queue.insert(k as u32, (8 - known) as f32);
    }
    let mut from: Vec<usize> = Vec::with_capacity(8);
    while let Some(k) = queue.pop() {
        let k = k as usize;
        let at = holes[k] as usize;
        from.clear();
        from.extend(neighbours8(sides, at).filter(|&n| valid(&filled, n)));
        if from.is_empty() {
            continue;
        }
        fill(at, &from);
        filled[k] = true;
        for n in neighbours8(sides, at) {
            if let Some(m) = hole(n).filter(|&m| queue.contains(m as u32)) {
                queue.update(m as u32, queue.key(m as u32) - 1.0);
            }
        }
    }
}

/// The most bytes a texel holds in the infill or in the dilation, the larger of the two: the
/// infill's texel (4), its state (1) and its queue's id, key and slot (12) — 17 —; the dilation's
/// role, mark and rings (18) and a byte of the round's ring — 19.
pub(crate) const INFILL_HOLE_BYTES: usize = 19;

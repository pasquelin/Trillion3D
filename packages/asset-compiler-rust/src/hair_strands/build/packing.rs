//! Step 2 of the build (`build.rs`): the curves of a group measured, shuffled and packed on the
//! workers of the pool, with the streams the seeds and the shuffle are drawn from.
use super::{Group, Raw};
use crate::hair_strands::abi::{
    HAIR_STRANDS_ATTRIBUTE_COLOR, HAIR_STRANDS_ATTRIBUTE_ROOT_UV, HAIR_STRANDS_ATTRIBUTE_ROUGHNESS,
    HAIR_STRANDS_CONTROL_POINT_END, HAIR_STRANDS_CONTROL_POINT_INSIDE,
    HAIR_STRANDS_CONTROL_POINT_START, HAIR_STRANDS_FLAG_SHUFFLED_CURVE, HAIR_STRANDS_POINT_BYTES,
};
use half::f16;
use rayon::prelude::*;
use trillion3d_math::vector::vecn::{length, sub};

/// The seeds of the curves are whole numbers below this one.
const SEED_RANGE: f32 = 255.0;
/// The streams the seeds and the shuffle are drawn from: a linear congruence over 32 bits, whose top
/// 23 bits make the mantissa of a float from 1 to 2. A group's seeds start from its number, its
/// curves' shuffle from a number of its own.
const STREAM_MULTIPLIER: u32 = 196_314_165;
const STREAM_INCREMENT: u32 = 907_633_515;
const SHUFFLE_SEED: u32 = 0xdeed_beed;
/// A root coordinate of exactly 1 is nudged under it, so that it stays on the tile it ends.
const ROOT_UV_NUDGE: f64 = 1e-5_f32 as f64;
/// The steps of a root coordinate within its tile, and the tiles a sheet counts along each axis.
const ROOT_UV_STEPS: f64 = 2047.0;
const ROOT_UV_TILES: f64 = 31.0;

/// A stream of numbers from 0 to 1, seeded: the generator the seeds and the shuffle share.
struct Stream(u32);

impl Stream {
    fn fraction(&mut self) -> f32 {
        self.0 = self
            .0
            .wrapping_mul(STREAM_MULTIPLIER)
            .wrapping_add(STREAM_INCREMENT);
        f32::from_bits(0x3F80_0000 | (self.0 >> 9)) - 1.0
    }
}

/// The seed of each of `curves` curves of group `id`.
fn seeds(id: i32, curves: usize) -> Vec<u8> {
    let mut stream = Stream(id as u32);
    (0..curves)
        .map(|_| (stream.fraction() * SEED_RANGE) as i32 as u8)
        .collect()
}

/// The order the `curves` curves of a group are shuffled into: the curve each rank takes. Each curve
/// in turn is swapped with one the stream draws from the whole group.
fn shuffle(curves: usize) -> Vec<usize> {
    let mut stream = Stream(SHUFFLE_SEED);
    let mut order: Vec<usize> = (0..curves).collect();
    for at in 0..curves {
        let other = ((stream.fraction() * curves as f32) as usize).min(curves - 1);
        order.swap(at, other);
    }
    order
}

/// A root coordinate on a word: 11 bits for each axis within its tile, 5 for the tile along each.
fn pack_root_uv(uv: [f32; 2]) -> u32 {
    let axis = |value: f32| {
        let value = f64::from(value);
        let value = if value == 1.0 {
            value - ROOT_UV_NUDGE
        } else {
            value
        };
        let within = value - value.trunc();
        let steps = (within * ROOT_UV_STEPS).clamp(0.0, ROOT_UV_STEPS) as u32 & 0x7FF;
        let tile = (value - within).clamp(0.0, ROOT_UV_TILES) as u32 & 0x1F;
        (steps, tile)
    };
    let ((x, tile_x), (y, tile_y)) = (axis(uv[0]), axis(uv[1]));
    x | y << 11 | tile_x << 22 | tile_y << 27
}

/// A colour on a word: the square root of each channel on 11, 11 and 10 bits.
fn pack_color(color: [f32; 3]) -> u32 {
    let channel =
        |value: f32, scale: f32, most: u32| ((value.max(0.0).sqrt() * scale) as u32).min(most);
    channel(color[0], 2047.0, 0x7FF)
        | channel(color[1], 2047.0, 0x7FF) << 11
        | channel(color[2], 1023.0, 0x3FF) << 22
}

/// What measuring a curve yields: its length and the corners of its box.
struct Measured {
    length: f32,
    low: [f32; 3],
    high: [f32; 3],
}

/// The length and the box of a curve through `points`; `along` takes each point's distance along it.
fn measure(points: &[[f32; 3]], along: &mut [f32]) -> Measured {
    let (mut low, mut high) = ([f32::MAX; 3], [f32::MIN; 3]);
    let mut total = 0.0f32;
    for (k, current) in points.iter().enumerate() {
        for axis in 0..3 {
            low[axis] = low[axis].min(current[axis]);
            high[axis] = high[axis].max(current[axis]);
        }
        if k > 0 {
            total += length(sub(*current, points[k - 1]));
        }
        along[k] = total;
    }
    Measured {
        length: total,
        low,
        high,
    }
}

/// `buffer` cut into consecutive pieces of the given lengths, which it must hold.
fn pieces<T>(buffer: &mut [T], lengths: impl Iterator<Item = usize>) -> Vec<&mut [T]> {
    let mut rest = buffer;
    lengths
        .map(|length| {
            let (piece, after) = std::mem::take(&mut rest).split_at_mut(length);
            rest = after;
            piece
        })
        .collect()
}

/// Step 2: the curves of a group measured in the order of the file, then shuffled and packed — both
/// on the workers of the pool, a curve at a time; none if the group kept no curve.
pub(super) fn pack(raw: Raw, per_point: bool) -> Option<Group> {
    if raw.counts.is_empty() {
        return None;
    }
    let curves = raw.counts.len();
    let counts: Vec<usize> = raw.counts.iter().map(|&count| usize::from(count)).collect();
    let starts: Vec<usize> = (counts.iter())
        .scan(0usize, |at, &count| {
            *at += count;
            Some(*at - count)
        })
        .collect();
    let mut along = vec![0.0f32; raw.positions.len()];
    let measured: Vec<Measured> = pieces(&mut along, counts.iter().copied())
        .into_par_iter()
        .zip(starts.par_iter())
        .zip(counts.par_iter())
        .map(|((along, &start), &count)| measure(&raw.positions[start..start + count], along))
        .collect();
    let (mut low, mut high) = ([f32::MAX; 3], [f32::MIN; 3]);
    let mut max_length = 0.0f32;
    for one in &measured {
        for axis in 0..3 {
            low[axis] = low[axis].min(one.low[axis]);
            high[axis] = high[axis].max(one.high[axis]);
        }
        max_length = max_length.max(one.length);
    }
    let max_radius = raw
        .radii
        .iter()
        .fold(0.0f32, |most, &radius| most.max(radius));
    let centre: [f32; 3] = std::array::from_fn(|axis| (low[axis] + high[axis]) * 0.5);
    let normalized = |radius: f32| match max_radius > 0.0 {
        true => radius / max_radius,
        false => 0.0,
    };
    let order = shuffle(curves);
    let ranked: Vec<usize> = order.iter().map(|&curve| counts[curve]).collect();
    let mut points = vec![0u8; raw.positions.len() * HAIR_STRANDS_POINT_BYTES];
    let mut colors = vec![0u32; raw.colors.len()];
    let mut roughness = vec![0u8; raw.roughness.len()];
    // The points a curve takes in a table the file gives, none in one it does not.
    let taken = |held: usize| {
        ranked
            .iter()
            .map(move |&count| if held > 0 { count } else { 0 })
    };
    pieces(
        &mut points,
        ranked.iter().map(|&count| count * HAIR_STRANDS_POINT_BYTES),
    )
    .into_par_iter()
    .zip(pieces(&mut colors, taken(raw.colors.len())))
    .zip(pieces(&mut roughness, taken(raw.roughness.len())))
    .zip(order.par_iter())
    .for_each(|(((points, colors), roughness), &curve)| {
        let (start, count, length) = (starts[curve], counts[curve], measured[curve].length);
        for (k, point) in points
            .chunks_exact_mut(HAIR_STRANDS_POINT_BYTES)
            .enumerate()
        {
            let i = start + k;
            for axis in 0..3 {
                let relative = raw.positions[i][axis] - centre[axis];
                point[axis * 2..axis * 2 + 2]
                    .copy_from_slice(&f16::from_f32(relative).to_le_bytes());
            }
            let radius = raw.radii[if per_point { i } else { curve }];
            let kind = match k {
                0 => HAIR_STRANDS_CONTROL_POINT_START,
                k if k + 1 == count => HAIR_STRANDS_CONTROL_POINT_END,
                _ => HAIR_STRANDS_CONTROL_POINT_INSIDE,
            };
            let u = if length > 0.0 {
                along[i] / length
            } else {
                along[i]
            };
            point[6] = (u * 255.0).clamp(0.0, 255.0) as u8;
            point[7] = (normalized(radius) * 63.0).clamp(0.0, 63.0) as u8 | kind << 6;
        }
        // The pieces of a table the file does not give are empty, and so is what is read of it.
        let given = start..start + count;
        for (slot, &color) in colors
            .iter_mut()
            .zip(raw.colors.get(given.clone()).unwrap_or_default())
        {
            *slot = pack_color(color);
        }
        for (slot, &value) in roughness
            .iter_mut()
            .zip(raw.roughness.get(given).unwrap_or_default())
        {
            *slot = ((value.max(0.0) * 255.0) as u32).min(255) as u8;
        }
    });
    let curve_words = ranked.iter().scan(0usize, |offset, &count| {
        let word = *offset as u32 | (count as u32) << 24;
        *offset += count;
        Some(word)
    });
    let root_uvs = match raw.root_uvs.is_empty() {
        true => Vec::new(),
        false => (order.iter())
            .map(|&curve| pack_root_uv(raw.root_uvs[curve]))
            .collect(),
    };
    let attributes = [
        (!raw.root_uvs.is_empty(), HAIR_STRANDS_ATTRIBUTE_ROOT_UV),
        (!raw.colors.is_empty(), HAIR_STRANDS_ATTRIBUTE_COLOR),
        (!raw.roughness.is_empty(), HAIR_STRANDS_ATTRIBUTE_ROUGHNESS),
    ]
    .iter()
    .filter(|(held, _)| *held)
    .fold(0, |bits, (_, bit)| bits | bit);
    Some(Group {
        id: raw.id,
        flags: raw.flags | HAIR_STRANDS_FLAG_SHUFFLED_CURVE,
        attributes,
        source_curves: raw.source_curves,
        source_points: raw.source_points,
        curves: curve_words.collect(),
        points,
        seeds: seeds(raw.id, curves),
        lengths: (order.iter())
            .map(|&curve| f16::from_f32(measured[curve].length).to_bits())
            .collect(),
        root_uvs,
        colors,
        roughness,
        max_length,
        max_radius,
        low,
        high,
    })
}

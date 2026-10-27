//! The groom builder, its file and the way a groom travels in a scene, on grooms of a few points.
use super::abi::HAIR_STRANDS_FLAG_SHUFFLED_CURVE;
use super::build::{groups as build_groups, Group};
use super::description::Description;
use std::sync::atomic::AtomicBool;

mod builder;
mod carrier;
mod file;
mod grouping;
mod merge;
mod scopes;

/// The flag every built group carries beside the ones its curves raise.
const SHUFFLED: u32 = HAIR_STRANDS_FLAG_SHUFFLED_CURVE;

/// The groups of `description`, built under a token no one raises.
fn groups(description: &Description, ending_point: bool) -> Vec<Group> {
    build_groups(description, ending_point, &AtomicBool::new(false)).expect("built")
}

/// The numbers of `points`, one after the other.
fn flat(points: &[[f32; 3]]) -> Vec<f32> {
    points.iter().flatten().copied().collect()
}

/// A groom of strands of `counts` points along `points`, each of width 0.02.
fn groom(counts: &[u32], points: &[[f32; 3]]) -> Description {
    Description {
        positions: flat(points),
        counts: counts.to_vec(),
        groom_width: Some(0.02),
        ..Description::default()
    }
}

/// Points along x, one unit apart, from x = `from`.
fn row(from: f32, count: usize) -> Vec<[f32; 3]> {
    (0..count).map(|k| [from + k as f32, 0.0, 0.0]).collect()
}

/// The point `k` of `group`'s table: its three half floats, then its two bytes.
fn point(group: &Group, k: usize) -> ([u16; 3], u8, u8) {
    let at = k * 8;
    let half = |axis: usize| {
        u16::from_le_bytes([group.points[at + axis * 2], group.points[at + axis * 2 + 1]])
    };
    (
        [half(0), half(1), half(2)],
        group.points[at + 6],
        group.points[at + 7],
    )
}

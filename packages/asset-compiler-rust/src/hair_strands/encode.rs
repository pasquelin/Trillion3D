//! `hairStrands.bin` and the manifest's `hairStrands` section.
//!
//! Little-endian: a head (`HAIR_STRANDS_HEAD_BYTES`) — the magic, the version, the group count and the
//! point count —, a record per group (`HAIR_STRANDS_GROUP_BYTES`, its words named in
//! `hairStrandsAbi.ts`), then the tables of every group one after the other: the curves (a word
//! each), the points (`HAIR_STRANDS_POINT_BYTES`, from a multiple of `HAIR_STRANDS_POINTS_ALIGNMENT`
//! bytes of the file), the curves' seeds, their lengths, their root coordinates, the points' colours
//! and their roughness — each of the last five only for the groups that carry it, padded to
//! `HAIR_STRANDS_TABLE_ALIGNMENT` bytes at its end. Each table is streamed to the file group after
//! group as it is, so the file is never held whole.
use super::abi::{
    HAIR_STRANDS_AT_ATTRIBUTES, HAIR_STRANDS_AT_BOUNDS_MAX, HAIR_STRANDS_AT_BOUNDS_MIN,
    HAIR_STRANDS_AT_CURVE_COUNT, HAIR_STRANDS_AT_FIRST_COLOR, HAIR_STRANDS_AT_FIRST_CURVE,
    HAIR_STRANDS_AT_FIRST_POINT, HAIR_STRANDS_AT_FIRST_ROOT_UV, HAIR_STRANDS_AT_FIRST_ROUGHNESS,
    HAIR_STRANDS_AT_FLAGS, HAIR_STRANDS_AT_GROUP_ID, HAIR_STRANDS_AT_MAX_LENGTH,
    HAIR_STRANDS_AT_MAX_RADIUS, HAIR_STRANDS_AT_POINT_COUNT, HAIR_STRANDS_AT_SOURCE_CURVES,
    HAIR_STRANDS_AT_SOURCE_POINTS, HAIR_STRANDS_FILE, HAIR_STRANDS_GROUP_BYTES,
    HAIR_STRANDS_GROUP_WORDS, HAIR_STRANDS_HEAD_BYTES, HAIR_STRANDS_MAGIC,
    HAIR_STRANDS_POINTS_ALIGNMENT, HAIR_STRANDS_POINT_BYTES, HAIR_STRANDS_TABLE_ALIGNMENT,
    HAIR_STRANDS_VERSION,
};
use super::build::Group;
use crate::compiler::cache::storage::{atomic_with, Hashing, Product};
use crate::Result;
use bytemuck::cast_slice;
use serde_json::{json, Value};
use std::io::{self, Write};
use std::path::Path;

// The tables go into the file as they lie in memory, which the file reads little-endian.
const _: () = assert!(cfg!(target_endian = "little"));

/// The ranks of the first entry of a group in each table, as the tables count them so far.
#[derive(Default)]
struct Ranks {
    curves: usize,
    points: usize,
    root_uvs: usize,
    colors: usize,
    roughness: usize,
}

/// A writer that counts the bytes it passes on, to pad each table to its alignment.
struct Laid<W: Write> {
    out: W,
    at: usize,
}

impl<W: Write> Laid<W> {
    fn put(&mut self, bytes: &[u8]) -> io::Result<()> {
        self.out.write_all(bytes)?;
        self.at += bytes.len();
        Ok(())
    }

    /// Zeros to the next multiple of `to` bytes.
    fn pad(&mut self, to: usize) -> io::Result<()> {
        let end = self.at.next_multiple_of(to);
        while self.at < end {
            self.put(&[0])?;
        }
        Ok(())
    }
}

/// The points a group holds.
fn point_count(group: &Group) -> usize {
    group.points.len() / HAIR_STRANDS_POINT_BYTES
}

/// The record of `group`, whose first entries lie at `ranks`.
fn record(group: &Group, ranks: &Ranks) -> [u32; HAIR_STRANDS_GROUP_WORDS] {
    let mut words = [0u32; HAIR_STRANDS_GROUP_WORDS];
    let held = |held: bool, rank: usize| if held { rank as u32 } else { 0 };
    words[HAIR_STRANDS_AT_GROUP_ID] = group.id as u32;
    words[HAIR_STRANDS_AT_FLAGS] = group.flags;
    words[HAIR_STRANDS_AT_ATTRIBUTES] = group.attributes;
    words[HAIR_STRANDS_AT_CURVE_COUNT] = group.curves.len() as u32;
    words[HAIR_STRANDS_AT_POINT_COUNT] = point_count(group) as u32;
    words[HAIR_STRANDS_AT_FIRST_CURVE] = ranks.curves as u32;
    words[HAIR_STRANDS_AT_FIRST_POINT] = ranks.points as u32;
    words[HAIR_STRANDS_AT_FIRST_ROOT_UV] = held(!group.root_uvs.is_empty(), ranks.root_uvs);
    words[HAIR_STRANDS_AT_FIRST_COLOR] = held(!group.colors.is_empty(), ranks.colors);
    words[HAIR_STRANDS_AT_FIRST_ROUGHNESS] = held(!group.roughness.is_empty(), ranks.roughness);
    words[HAIR_STRANDS_AT_MAX_LENGTH] = group.max_length.to_bits();
    words[HAIR_STRANDS_AT_MAX_RADIUS] = group.max_radius.to_bits();
    words[HAIR_STRANDS_AT_BOUNDS_MIN..HAIR_STRANDS_AT_BOUNDS_MIN + 3]
        .copy_from_slice(&group.low.map(f32::to_bits));
    words[HAIR_STRANDS_AT_BOUNDS_MAX..HAIR_STRANDS_AT_BOUNDS_MAX + 3]
        .copy_from_slice(&group.high.map(f32::to_bits));
    words[HAIR_STRANDS_AT_SOURCE_CURVES] = group.source_curves;
    words[HAIR_STRANDS_AT_SOURCE_POINTS] = group.source_points;
    words
}

/// The curves and the points `groups` hold together.
fn totals(groups: &[Group]) -> (usize, usize) {
    let curves = groups.iter().map(|group| group.curves.len()).sum();
    (curves, groups.iter().map(point_count).sum())
}

/// Streams the file holding `groups` into `out`.
fn lay<W: Write>(out: &mut Laid<W>, groups: &[Group]) -> io::Result<()> {
    let head = [
        HAIR_STRANDS_MAGIC,
        HAIR_STRANDS_VERSION,
        groups.len() as u32,
        totals(groups).1 as u32,
    ];
    out.put(cast_slice(&head))?;
    let mut ranks = Ranks::default();
    for group in groups {
        out.put(cast_slice(&record(group, &ranks)))?;
        ranks.curves += group.curves.len();
        ranks.points += point_count(group);
        ranks.root_uvs += group.root_uvs.len();
        ranks.colors += group.colors.len();
        ranks.roughness += group.roughness.len();
    }
    for group in groups {
        out.put(cast_slice(&group.curves))?;
    }
    out.pad(HAIR_STRANDS_POINTS_ALIGNMENT)?;
    for group in groups {
        out.put(&group.points)?;
    }
    for group in groups {
        out.put(&group.seeds)?;
    }
    out.pad(HAIR_STRANDS_TABLE_ALIGNMENT)?;
    for group in groups {
        out.put(cast_slice(&group.lengths))?;
    }
    out.pad(HAIR_STRANDS_TABLE_ALIGNMENT)?;
    for group in groups {
        out.put(cast_slice(&group.root_uvs))?;
    }
    for group in groups {
        out.put(cast_slice(&group.colors))?;
    }
    for group in groups {
        out.put(&group.roughness)?;
    }
    out.pad(HAIR_STRANDS_TABLE_ALIGNMENT)
}

/// Writes the file holding `groups` in `directory`, atomically, fingerprinted as it goes by.
pub(super) fn write(groups: &[Group], directory: &Path) -> Result<Product> {
    atomic_with(&directory.join(HAIR_STRANDS_FILE), |file| {
        let mut out = Laid {
            out: Hashing::new(file),
            at: 0,
        };
        lay(&mut out, groups)?;
        out.out.flush()?;
        Ok(out.out.product(HAIR_STRANDS_FILE))
    })
}

/// The manifest's `hairStrands` section: the file's version, name, size and layout, and every group.
pub(super) fn report(groups: &[Group], bytes: usize) -> Value {
    let (curves, points) = totals(groups);
    let listed: Vec<Value> = groups
        .iter()
        .map(|group| {
            json!({"groupId": group.id, "curves": group.curves.len(),
                "points": point_count(group), "flags": group.flags})
        })
        .collect();
    json!({"version": HAIR_STRANDS_VERSION, "file": HAIR_STRANDS_FILE, "bytes": bytes,
        "headBytes": HAIR_STRANDS_HEAD_BYTES, "groupBytes": HAIR_STRANDS_GROUP_BYTES,
        "curves": curves, "points": points, "groups": listed})
}

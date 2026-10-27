//! The groups of a description, built with one level of detail, no interpolation, no guides and no
//! clusters — the strands as they are drawn at rest.
//!
//! In the order a groom is built:
//! 1. **Groups** (`read`). The strands are cut by group number when the file gives one, else by group
//!    name, else they make the one group 0; each group is met in the order of its first strand, a
//!    group cut by name taking the rank it is met at for its number. A strand of no point is counted
//!    as declared and goes no further; one with a point that is not finite is left out and flagged
//!    (`HAIR_STRANDS_FLAG_INVALID_POINT`); points past the 255th of a strand are dropped and flagged
//!    (`HAIR_STRANDS_FLAG_TRIMMED_POINT`); one that would make the group hold more curves or points
//!    than a record addresses is left out and flagged (`HAIR_STRANDS_FLAG_TRIMMED_CURVE`). A strand of
//!    at least two points and of fewer than 255 gets one control point more at its end when the build
//!    asks for it, a tenth of its last segment past its last point, so that the last segment of a
//!    strip is not lost (`HAIR_STRANDS_FLAG_EXTRA_ENDING_POINT`). A point's radius is half its width:
//!    the point's own when the file gives one for each point, else its strand's, else the groom's.
//! 2. **Shuffle and packing** (`pack`). The curves of a group are shuffled by a fixed stream, so that
//!    any prefix of them covers the group evenly (`HAIR_STRANDS_FLAG_SHUFFLED_CURVE`). Each curve's
//!    length is the sum of its segments, a point's `u` its distance along the curve over that length;
//!    the group's box is that of its points, its longest curve and its greatest radius are the
//!    greatest of its curves and of its points. Each point goes on eight bytes, its position relative
//!    to the centre of the box in half floats, its `u` times 255, its radius over the greatest times
//!    63 and its kind of control point; each curve on a word; a seed for each curve, in the order of
//!    the shuffle, from the stream of its group number; the curves' lengths as half floats, the roots'
//!    coordinates, the points' colours and roughness in the bits the file's values fill.
use super::abi::{
    HAIR_STRANDS_FLAG_EXTRA_ENDING_POINT, HAIR_STRANDS_FLAG_INVALID_POINT,
    HAIR_STRANDS_FLAG_ROOT_TILE, HAIR_STRANDS_FLAG_TRIMMED_CURVE, HAIR_STRANDS_FLAG_TRIMMED_POINT,
    HAIR_STRANDS_MAX_CURVES_PER_GROUP, HAIR_STRANDS_MAX_POINTS_PER_CURVE,
    HAIR_STRANDS_MAX_POINTS_PER_GROUP,
};
use super::description::{Description, Widths, DEFAULT_WIDTH};
use crate::plugins::scene::cancel;
use crate::Result;
use packing::pack;
use rayon::prelude::*;
use std::collections::HashMap;
use std::sync::atomic::AtomicBool;

mod packing;

/// How far past a curve's last point the control point added at its end lies, over its last segment.
const ENDING_POINT_SHARE: f32 = 0.1;

/// One group of strands, built: what `encode.rs` lays in the file.
pub(super) struct Group {
    pub(super) id: i32,
    pub(super) flags: u32,
    pub(super) attributes: u32,
    /// The curves and points the file declared for the group, kept or not.
    pub(super) source_curves: u32,
    pub(super) source_points: u32,
    /// Each curve's first point within the group and its point count, on a word.
    pub(super) curves: Vec<u32>,
    /// Each point on `HAIR_STRANDS_POINT_BYTES` bytes.
    pub(super) points: Vec<u8>,
    pub(super) seeds: Vec<u8>,
    /// Each curve's length as half-float bits.
    pub(super) lengths: Vec<u16>,
    pub(super) root_uvs: Vec<u32>,
    pub(super) colors: Vec<u32>,
    pub(super) roughness: Vec<u8>,
    pub(super) max_length: f32,
    pub(super) max_radius: f32,
    pub(super) low: [f32; 3],
    pub(super) high: [f32; 3],
}

/// A group as the file's strands make it, before its curves are shuffled and measured.
pub(super) struct Raw {
    id: i32,
    flags: u32,
    source_curves: u32,
    source_points: u32,
    counts: Vec<u16>,
    positions: Vec<[f32; 3]>,
    /// The radius of each point when the widths are given for each point, else of each curve.
    radii: Vec<f32>,
    root_uvs: Vec<[f32; 2]>,
    colors: Vec<[f32; 3]>,
    roughness: Vec<f32>,
}

impl Raw {
    fn new(id: i32) -> Self {
        Self {
            id,
            flags: 0,
            source_curves: 0,
            source_points: 0,
            counts: Vec::new(),
            positions: Vec::new(),
            radii: Vec::new(),
            root_uvs: Vec::new(),
            colors: Vec::new(),
            roughness: Vec::new(),
        }
    }
}

/// How the strands are cut into groups: by their number where the file gives numbers, else by their
/// name, else all in one.
struct Cutting<'a> {
    d: &'a Description,
    by_id: HashMap<i32, usize>,
    /// The slot of each name by what the name is — a name has no case, and none is the empty one —,
    /// and the slot of each rank of the description's names once met.
    by_name: HashMap<String, usize>,
    rank_slot: Vec<Option<usize>>,
}

impl<'a> Cutting<'a> {
    fn new(d: &'a Description) -> Self {
        Self {
            d,
            by_id: HashMap::new(),
            by_name: HashMap::new(),
            rank_slot: vec![None; d.names.len()],
        }
    }

    /// The group `strand` belongs to in `groups`, which it adds when it is the first of its group.
    fn slot(&mut self, strand: usize, groups: &mut Vec<Raw>) -> usize {
        let add = |groups: &mut Vec<Raw>, id: i32| {
            groups.push(Raw::new(id));
            groups.len() - 1
        };
        if let Some(&id) = self.d.group_ids.get(strand) {
            return *self.by_id.entry(id).or_insert_with(|| add(groups, id));
        }
        if let Some(&rank) = self.d.group_names.get(strand) {
            let rank = rank as usize;
            if let Some(slot) = self.rank_slot[rank] {
                return slot;
            }
            let name = &self.d.names[rank];
            let key = match name.is_empty() {
                true => "none".to_string(),
                false => name.to_lowercase(),
            };
            let number = groups.len() as i32;
            let slot = *self
                .by_name
                .entry(key)
                .or_insert_with(|| add(groups, number));
            self.rank_slot[rank] = Some(slot);
            return slot;
        }
        *self.by_id.entry(0).or_insert_with(|| add(groups, 0))
    }
}

/// The groups of `description` in the order of their first strand, each built on the workers of the
/// pool; those that kept no curve are left out. `ending_point` says whether a curve is given the
/// control point at its end.
pub(super) fn groups(
    description: &Description,
    ending_point: bool,
    cancelled: &AtomicBool,
) -> Result<Vec<Group>> {
    let per_point = matches!(description.widths, Widths::Vertex(_));
    let built: Vec<Option<Group>> = read(description, ending_point, per_point)
        .into_par_iter()
        .map(|raw| {
            cancel::check(cancelled)?;
            Ok(pack(raw, per_point))
        })
        .collect::<Result<_>>()?;
    Ok(built.into_iter().flatten().collect())
}

/// `values` as the points of three numbers each they hold.
fn triples(values: &[f32]) -> &[[f32; 3]] {
    values.as_chunks::<3>().0
}

/// Step 1: the strands cut into groups. `per_point` says the widths are given for each point.
fn read(d: &Description, ending_point: bool, per_point: bool) -> Vec<Raw> {
    let mut groups: Vec<Raw> = Vec::new();
    let mut cutting = Cutting::new(d);
    let groom_radius = d.groom_width.unwrap_or(DEFAULT_WIDTH) * 0.5;
    let (colors, roughness) = (triples(&d.colors), &d.roughness);
    let mut next = 0usize;
    for (strand, &declared) in d.counts.iter().enumerate() {
        let slot = cutting.slot(strand, &mut groups);
        let group = &mut groups[slot];
        let count = declared as usize;
        let first = next;
        next += count;
        group.source_curves += 1;
        group.source_points = group.source_points.saturating_add(declared);
        if count == 0 {
            continue;
        }
        let span = &d.positions[first * 3..(first + count) * 3];
        if span.iter().any(|value| !value.is_finite()) {
            group.flags |= HAIR_STRANDS_FLAG_INVALID_POINT;
            continue;
        }
        if count > HAIR_STRANDS_MAX_POINTS_PER_CURVE {
            group.flags |= HAIR_STRANDS_FLAG_TRIMMED_POINT;
        }
        let kept = count.min(HAIR_STRANDS_MAX_POINTS_PER_CURVE);
        // A curve of one point has no segment to extend: its ending point would be taken from the
        // last point of the curve before it.
        let ending = ending_point && count >= 2 && count < HAIR_STRANDS_MAX_POINTS_PER_CURVE;
        let added = kept + usize::from(ending);
        // The point a curve starts at is written on 24 bits, and a loader that streams a group reads
        // no more points of it than those bits count: a curve that starts past them would read other
        // curves' points, and is left out.
        if group.counts.len() >= HAIR_STRANDS_MAX_CURVES_PER_GROUP
            || group.positions.len() + added > HAIR_STRANDS_MAX_POINTS_PER_GROUP
        {
            group.flags |= HAIR_STRANDS_FLAG_TRIMMED_CURVE;
            continue;
        }
        if ending {
            group.flags |= HAIR_STRANDS_FLAG_EXTRA_ENDING_POINT;
        }
        group.counts.push(added as u16);
        group.positions.extend(&triples(span)[..kept]);
        if !d.root_uvs.is_empty() {
            let uv = [d.root_uvs[strand * 2], d.root_uvs[strand * 2 + 1]];
            if uv[0] > 1.0 || uv[1] > 1.0 {
                group.flags |= HAIR_STRANDS_FLAG_ROOT_TILE;
            }
            group.root_uvs.push(uv);
        }
        match &d.widths {
            Widths::Vertex(widths) => {
                group
                    .radii
                    .extend(widths[first..first + kept].iter().map(|width| width * 0.5));
            }
            Widths::Strand(widths) => group.radii.push(widths[strand] * 0.5),
            Widths::None => group.radii.push(groom_radius),
        }
        if !colors.is_empty() {
            group.colors.extend(&colors[first..first + kept]);
        }
        if !roughness.is_empty() {
            group.roughness.extend(&roughness[first..first + kept]);
        }
        if ending {
            // A tenth of the last segment, from the last point on; the point is the last one's in
            // everything else.
            let last = group.positions.len();
            let (p0, p1) = (group.positions[last - 1], group.positions[last - 2]);
            group.positions.push(std::array::from_fn(|axis| {
                p0[axis] + (p0[axis] - p1[axis]) * ENDING_POINT_SHARE
            }));
            if per_point {
                group.radii.push(group.radii[group.radii.len() - 1]);
            }
            if !colors.is_empty() {
                group.colors.push(group.colors[group.colors.len() - 1]);
            }
            if !roughness.is_empty() {
                group
                    .roughness
                    .push(group.roughness[group.roughness.len() - 1]);
            }
        }
    }
    groups
}

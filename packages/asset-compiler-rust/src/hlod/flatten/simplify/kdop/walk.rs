//! The walk of the tree along a segment (`closest`): from the root, each node's four boxes slabbed
//! at once — its children's and its left child's children's, so the left child, when entered,
//! takes its children's tests from its parent —; of two children met, the one whose box is
//! entered first is walked first, the right one on a tie, and the other only while its box is
//! entered before the nearest hit the first left; a leaf's triangles tested in turn
//! (`face::met`). The steps wait on a stack, each deferred child with the fraction its box is
//! entered at, read again against the nearest hit when its turn comes, so no step recurses.
use super::face::met;
use super::{Below, Bounds, Hit, Tree};
use crate::hlod::flatten::uv::extremes::{least, most};
use trillion3d_math::scalar::not_below;

/// The inverse of a segment's span along an axis it does not move along: single precision's
/// largest value, widened.
const FLAT: f64 = f32::MAX as f64;

/// The segment a walk follows: its ends, its span from start to end and the inverse of that span
/// along each axis (`FLAT` along an axis it does not move along).
pub(super) struct Segment {
    pub start: [f64; 3],
    pub end: [f64; 3],
    pub along: [f64; 3],
    inverse: [f64; 3],
}

impl Segment {
    /// The segment from `start` to `end`.
    pub(super) fn of(start: [f64; 3], end: [f64; 3]) -> Self {
        let along = std::array::from_fn(|k| end[k] - start[k]);
        let inverse = along.map(|d: f64| if d != 0.0 { 1.0 / d } else { FLAT });
        Self {
            start,
            end,
            along,
            inverse,
        }
    }
}

/// The children's tests a node's parent made: the fractions their boxes are entered at and whether
/// the segment meets them, left then right.
type Tested = ([f64; 2], [bool; 2]);

/// A node the walk still visits: its rank, its children's tests when its parent made them, and the
/// fraction its box is entered at when it waits on its sibling — visited only if that comes before
/// the nearest hit then.
#[derive(Clone, Copy)]
pub(super) struct Step {
    node: u32,
    tested: Option<Tested>,
    after: Option<f64>,
}

/// For each of `boxes`, the fraction of `segment` its box is entered at, and whether the segment
/// meets it — leaving it at or past its start, after entering it, entering it before the nearest
/// hit so far, `time`.
fn slabs(boxes: &[Bounds; 4], segment: &Segment, time: f32) -> ([f64; 4], [bool; 4]) {
    let current = f64::from(time);
    let (mut entries, mut meets) = ([0.0; 4], [false; 4]);
    for (b, [low, high]) in boxes.iter().enumerate() {
        let (mut near, mut far) = ([0.0; 3], [0.0; 3]);
        for k in 0..3 {
            let from_low = (low[k] - segment.start[k]) * segment.inverse[k];
            let from_high = (high[k] - segment.start[k]) * segment.inverse[k];
            near[k] = least(from_low, from_high);
            far[k] = most(from_low, from_high);
        }
        let entry = most(most(near[0], near[1]), near[2]);
        let exit = least(least(far[0], far[1]), far[2]);
        entries[b] = entry;
        meets[b] = exit >= 0.0 && exit >= entry && current > entry;
    }
    (entries, meets)
}

/// The nearest triangle of `tree` `segment` meets (module doc), `steps` the walk's scratch.
pub(super) fn closest(tree: &Tree, segment: &Segment, steps: &mut Vec<Step>) -> Option<Hit> {
    steps.clear();
    steps.push(Step {
        node: 0,
        tested: None,
        after: None,
    });
    let mut time = 1.0f32;
    let mut found = None;
    while let Some(step) = steps.pop() {
        if step
            .after
            .is_some_and(|entry| not_below(entry, f64::from(time)))
        {
            continue;
        }
        let node = &tree.nodes[step.node as usize];
        let left = match node.below {
            Below::Faces(first, count) => {
                let faces = &tree.faces[first as usize..(first + count) as usize];
                if let Some(triangle) = met(faces, segment, &mut time) {
                    found = Some(triangle);
                }
                continue;
            }
            Below::Children(left) => left,
        };
        let ((entries, meets), grand) = match step.tested {
            Some(tested) => (tested, None),
            None => {
                let (e, m) = slabs(&node.boxes, segment, time);
                (
                    ([e[0], e[1]], [m[0], m[1]]),
                    Some(([e[2], e[3]], [m[2], m[3]])),
                )
            }
        };
        let left = Step {
            node: left,
            tested: grand,
            after: None,
        };
        let right = Step {
            node: left.node + 1,
            tested: None,
            after: None,
        };
        match meets {
            [true, true] if entries[0] < entries[1] => {
                steps.extend([
                    Step {
                        after: Some(entries[1]),
                        ..right
                    },
                    left,
                ]);
            }
            [true, true] => steps.extend([
                Step {
                    after: Some(entries[0]),
                    ..left
                },
                right,
            ]),
            [true, false] => steps.push(left),
            [false, true] => steps.push(right),
            [false, false] => {}
        }
    }
    found.map(|triangle| Hit { triangle, time })
}

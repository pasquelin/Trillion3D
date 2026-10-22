//! The tree's build (`built`): each run of more than four triangles split in two at a mean — the
//! axis of the greatest variance of the centroids, the last of equal ones,
//! each variance compared in double precision against the best so far kept in single precision;
//! the triangles whose centroid, narrowed to single precision, lies at or past the mean, narrowed
//! alike, swapped to the left from both ends inward; half the run to each side when one would be
//! empty —, the left child's run before the right one's, every node ranked as it is made; the
//! boxes then gathered from the leaves up, each leaf's the box of its corners, each parent's the
//! union of its children's.
use super::{Below, Bounds, Face, Node};
use trillion3d_math::scalar::{not_at_least, not_below};
use trillion3d_math::vector::vec3::{cross, unit_where_squared};
use trillion3d_math::vector::vecn::{dot, sub};

/// The most triangles a leaf holds.
const LEAF_MOST: usize = 4;

/// The squared length at or under which a triangle's normal has no direction: single precision's
/// small number, widened.
const SMALL: f64 = 1e-8f32 as f64;

/// A triangle as the build sorts it: its corners, widened, their centroid and its rank.
pub(super) struct Built {
    corners: [[f64; 3]; 3],
    centroid: [f64; 3],
    triangle: u32,
}

impl Built {
    /// Triangle `triangle` of corners `corners`: the centroid their sum times a third.
    pub(super) fn of(triangle: u32, corners: [[f32; 3]; 3]) -> Self {
        let corners = corners.map(|c| c.map(f64::from));
        let third = 1.0 / 3.0;
        let centroid =
            std::array::from_fn(|k| (corners[0][k] + corners[1][k] + corners[2][k]) * third);
        Self {
            corners,
            centroid,
            triangle,
        }
    }

    /// The triangle as a leaf holds it (`Face`).
    fn face(&self) -> Face {
        let [a, b, c] = self.corners;
        let normal = unit_where_squared(cross(sub(b, c), sub(a, c)), |square| square > SMALL)
            .unwrap_or([0.0; 3]);
        Face {
            corners: self.corners,
            plane: [normal[0], normal[1], normal[2], -dot(a, normal)],
            triangle: self.triangle,
        }
    }
}

/// `a` when it is at most `b`, else `b` (a box's low corner as it grows).
fn lower(a: f64, b: f64) -> f64 {
    if a <= b {
        a
    } else {
        b
    }
}

/// `a` when it is at least `b`, else `b` (a box's high corner as it grows).
fn upper(a: f64, b: f64) -> f64 {
    if a >= b {
        a
    } else {
        b
    }
}

/// The union of boxes `a` and `b`.
fn union([low, high]: Bounds, [other_low, other_high]: Bounds) -> Bounds {
    [
        std::array::from_fn(|k| lower(low[k], other_low[k])),
        std::array::from_fn(|k| upper(high[k], other_high[k])),
    ]
}

/// The box of `faces`' corners, face after face; a box of zeros for no face.
fn bounds_of(faces: &[Face]) -> Bounds {
    let mut corners = faces.iter().flat_map(|f| f.corners);
    let Some(first) = corners.next() else {
        return [[0.0; 3]; 2];
    };
    corners.fold([first, first], |bounds, p| union(bounds, [p, p]))
}

/// The rank in `run` of its first triangle going right, `run` reordered (module doc).
fn split(run: &mut [Built]) -> usize {
    let count = run.len();
    let mut mean = [0.0f64; 3];
    for t in run.iter() {
        (0..3).for_each(|k| mean[k] += t.centroid[k]);
    }
    mean.iter_mut().for_each(|m| *m /= count as f64);
    let mut variance = [0.0f64; 3];
    for t in run.iter() {
        (0..3).for_each(|k| variance[k] += (t.centroid[k] - mean[k]) * (t.centroid[k] - mean[k]));
    }
    // No axis wins only for centroids that are not numbers: the first axis then, split at zero.
    let (mut axis, mut best, mut at) = (0, 0.0f32, 0.0f32);
    for k in 0..3 {
        variance[k] /= count as f64;
        if variance[k] >= f64::from(best) {
            (axis, best, at) = (k, variance[k] as f32, mean[k] as f32);
        }
    }
    let along = |t: &Built| t.centroid[axis] as f32;
    let (mut left, mut right) = (-1isize, count as isize);
    loop {
        left += 1;
        while left < right && not_below(along(&run[left as usize]), at) {
            left += 1;
        }
        if left == right {
            break;
        }
        right -= 1;
        while left < right && not_at_least(along(&run[right as usize]), at) {
            right -= 1;
        }
        if left == right {
            break;
        }
        run.swap(left as usize, right as usize);
    }
    if left == count as isize || right == 0 {
        count / 2
    } else {
        left as usize
    }
}

/// The tree over `all` (module doc): its nodes and its leaves' faces.
pub(super) fn built(mut all: Vec<Built>) -> (Vec<Node>, Vec<Face>) {
    let mut runs = vec![(0, all.len())];
    let mut below = vec![Below::Faces(0, 0)];
    let mut faces = Vec::with_capacity(all.len());
    let mut pending = vec![0];
    while let Some(n) = pending.pop() {
        let (start, count) = runs[n];
        if count > LEAF_MOST {
            let left = start + split(&mut all[start..start + count]);
            let first = below.len();
            runs.extend([(start, left - start), (left, start + count - left)]);
            below.extend([Below::Faces(0, 0); 2]);
            below[n] = Below::Children(first as u32);
            pending.extend([first + 1, first]);
        } else {
            below[n] = Below::Faces(faces.len() as u32, count as u32);
            faces.extend(all[start..start + count].iter().map(Built::face));
        }
    }
    // Every child ranks after its parent: the boxes gathered from the last node back.
    let mut own: Vec<Bounds> = vec![[[0.0; 3]; 2]; below.len()];
    let mut boxes: Vec<[Bounds; 4]> = vec![[[[0.0; 3]; 2]; 4]; below.len()];
    for n in (0..below.len()).rev() {
        match below[n] {
            Below::Faces(first, count) => {
                own[n] = bounds_of(&faces[first as usize..(first + count) as usize]);
                boxes[n] = [own[n]; 4];
            }
            Below::Children(left) => {
                let l = left as usize;
                boxes[n] = [own[l], own[l + 1], boxes[l][0], boxes[l][1]];
                own[n] = union(own[l], own[l + 1]);
            }
        }
    }
    let nodes = (boxes.into_iter().zip(below))
        .map(|(boxes, below)| Node { boxes, below })
        .collect();
    (nodes, faces)
}

//! THE CUT of the ordered clusters (`cluster_in_order`): where the source order must be kept.
use trillion3d_math::geometry::aabb::merge_aabb;

type Box3 = ([f64; 3], [f64; 3]);

/// The rank, in `part`'s own order, that cuts it in two at the least cost — each side's count times
/// the squared diagonal of its boxes — among the multiples of `unit`, the size of a whole cluster:
/// the runs stay as few as the caps allow, and the cut still falls where the order jumps. A cost
/// no number can say keeps the middle multiple.
pub(super) fn cut_in_order(part: &[usize], boxes: &[Box3], unit: usize) -> usize {
    let join = |(mut low, mut high): Box3, (l, h): Box3| -> Box3 {
        merge_aabb(&mut low, &mut high, l, h);
        (low, high)
    };
    let empty: Box3 = ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]);
    let n = part.len();
    let mut after = vec![empty; n + 1];
    for i in (0..n).rev() {
        after[i] = join(after[i + 1], boxes[part[i]]);
    }
    let unit = unit.clamp(1, n - 1);
    let middle = (n / 2 / unit).max(1) * unit;
    let (mut before, mut best) = (empty, (f64::INFINITY, middle.min(n - 1)));
    for at in 1..n {
        before = join(before, boxes[part[at - 1]]);
        if !at.is_multiple_of(unit) {
            continue;
        }
        let cost = crate::split::split_cost((at, before), (n - at, after[at]));
        if cost < best.0 {
            best = (cost, at);
        }
    }
    best.1
}

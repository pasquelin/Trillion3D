//! What both packers share, the islands' (`packer.rs`) and the old layout's (`uv/legacy`): the
//! charts' placement in the square, each among the orientations tried (`place_charts`), the search
//! for the largest scale at which every chart fits (`search_scale`), the rebalancing of a scaling
//! (`rebalance`) and the rectangle a chart's box covers (`covering`). Each packer keeps its own
//! charts, orientations and precision.
use super::layout::Layout;
use super::raster::{Footprint, Raster};
use super::Rect;
use trillion3d_math::scalar::real::Real;
use trillion3d_page_codec::hash::WordMap;

/// How many rounds a scaling is rebalanced at most.
const ROUNDS: usize = 1000;

/// The rectangle that no placement beats.
const NO_RECT: Rect = Rect {
    x: u32::MAX,
    y: u32::MAX,
    w: u32::MAX,
    h: u32::MAX,
};

/// Where each raster seen found a place, by its digest (`Footprint::digest`: sixteen bytes a
/// raster, whatever its size), so a chart laid like one before it starts its search there.
#[derive(Default)]
struct Starts(WordMap<u128, (u32, u32)>);

/// How much of the square's width and height a rectangle puts out of reach: its far corner's
/// coordinates summed.
fn reach(rect: &Rect) -> u64 {
    (rect.x as u64 + rect.w as u64) + (rect.y as u64 + rect.h as u64)
}

/// The rectangle at the origin that a chart whose box covers `extent` texels takes in a square of
/// `size`: whole texels, one more than the box, none past the square.
pub(crate) fn covering(extent: [f32; 2], size: u32) -> Rect {
    let texels = |x: f32| ((x.abs() + 1.0).ceil() as u32).min(size);
    Rect {
        x: 0,
        y: 0,
        w: texels(extent[0]),
        h: texels(extent[1]),
    }
}

/// A chart laid in the square `layout`: for each of `orientations`, `prepare` fills the `raster`
/// with the chart's footprint in it and returns its rectangle at the origin (`covering`); the
/// footprint is slid over the square from where one like it was found before, row after row, to the
/// first place it fits, and the orientation that leaves the least of the square out of reach
/// (`reach`) wins, the first of equals — the search ending at the corner. The orientation, its
/// rectangle placed and its footprint; none where it fits in none.
fn best_placement(
    (layout, raster): (&Layout, &mut Raster),
    starts: &mut Starts,
    orientations: impl IntoIterator<Item = usize>,
    mut prepare: impl FnMut(usize, &mut Raster) -> Rect,
) -> Option<(usize, Rect, Footprint)> {
    let mut best: Option<(usize, Rect, Footprint)> = None;
    for orientation in orientations {
        let mut rect = prepare(orientation, raster);
        let current = best.as_ref().map_or(NO_RECT, |b| b.1);
        let beats = |r: &Rect| reach(r) < reach(&current);
        let mut placed = Rect {
            w: raster.used.width,
            h: raster.used.height,
            ..rect
        };
        let found = if placed.w == 0 && placed.h == 0 {
            // Nothing rasterized: it takes no place.
            true
        } else {
            let digest = raster.used.digest();
            if let Some(&(x, y)) = starts.0.get(&digest) {
                placed.x = x;
                placed.y = y;
            }
            let found = layout.find(&mut placed, &raster.used, &beats);
            if found {
                starts.0.insert(digest, (placed.x, placed.y));
                rect.x = placed.x;
                rect.y = placed.y;
            }
            found
        };
        if found && beats(&rect) {
            let corner = rect.x == 0 && rect.y == 0;
            best = Some((orientation, rect, raster.used.clone()));
            if corner {
                break;
            }
        }
    }
    best
}

/// Every chart of `charts`, largest first as given, laid in a new square of `size` texels
/// (`best_placement` among `orientations`, `prepare` filling the raster with a chart's footprint
/// in one), then turned to the orientation that won (`orient`) and moved to its place (`shift`
/// by the rectangle placed): the texels in use when they all fit, none when one fits nowhere.
pub(crate) fn place_charts<C>(
    charts: &mut [C],
    (size, raster): (u32, &mut Raster),
    orientations: &[usize],
    mut prepare: impl FnMut(&mut C, usize, &mut Raster) -> Rect,
    orient: impl Fn(&mut C, usize),
    shift: impl Fn(&mut C, &Rect),
) -> Option<u32> {
    let mut layout = Layout::new(size);
    let mut starts = Starts::default();
    for chart in charts.iter_mut() {
        let placed = best_placement(
            (&layout, &mut *raster),
            &mut starts,
            orientations.iter().copied(),
            |orientation, raster| prepare(chart, orientation, raster),
        );
        let (orientation, rect, chosen) = placed?;
        orient(chart, orientation);
        layout.alloc(&rect, &chosen);
        shift(chart, &rect);
    }
    Some(layout.used())
}

/// The charts of a square `side` texels wide whose areas total `total_area` before scaling, packed
/// as `pack` packs them at a scale — its efficiency, the share of the square used, when they all
/// fit —, left as they were at the largest scale found that fit. The scale starts where the charts
/// would cover half the square and is halved while they do not fit — each is a texel at a small
/// enough scale, and there are no more charts than texels —; it is then bisected six times between
/// the last that failed and the last that fit, the search stopping early when a fit gains no more
/// than a percent of efficiency on the one before.
pub(crate) fn search_scale<T, C>(
    (side, total_area): (T, T),
    charts: &mut Vec<C>,
    mut pack: impl FnMut(&mut [C], T) -> Option<T>,
) where
    T: Real + PartialOrd + From<f32>,
    C: Clone,
{
    let half = T::from(0.5f32);
    let mut fail = side * (T::ONE / total_area).sqrt();
    let mut pass = side * (half / total_area).sqrt();
    let (mut last, mut efficiency) = loop {
        if let Some(efficiency) = pack(&mut charts[..], pass) {
            break (charts.clone(), efficiency);
        }
        fail = pass;
        pass = pass * half;
    };
    for _ in 0..6 {
        let scale = half * (fail + pass);
        match pack(&mut charts[..], scale) {
            Some(fit) => {
                last.clone_from(charts);
                let gain = T::from(100.0f32) * (fit - efficiency).abs();
                efficiency = fit;
                if gain <= T::ONE {
                    break;
                }
                pass = scale;
            }
            None => fail = scale,
        }
    }
    *charts = last;
}

/// A scaling rebalanced round by round: `step` scales every chart by the factor it is given
/// — one at first — and returns how many charts reached the square's size and the charts' areas
/// now; the rounds stop when none or all of the `slots` did, or when the factor that would bring
/// the area back to `total_area` at `uv_scale` is under `minor`, else go on with it.
pub(crate) fn rebalance<T>(
    (uv_scale, total_area): (T, T),
    (slots, minor): (usize, T),
    mut step: impl FnMut(T) -> (usize, T),
) where
    T: Real + PartialOrd,
{
    let mut factor = T::ONE;
    for _ in 0..ROUNDS {
        let (maxed, scaled_area) = step(factor);
        if maxed == 0 || maxed == slots {
            break;
        }
        let ratio = uv_scale * (total_area / scaled_area).sqrt();
        if ratio < minor {
            break;
        }
        factor = ratio;
    }
}

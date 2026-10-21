//! The charts partitioned until the stretch bound and the chart count hold.
//!
//! Every queue of charts is a heap of equal keys: the first chart put in comes out first, then
//! the last put in at each step, as the library's heap gives them.
//!
//! 1. The initial charts: from the root, each chart taken from the queue is made simple and
//!    ranked; one that splits puts its children in the queue, one that does not is kept.
//! 2. The loop: each chart taken from the queue is partitioned, its children queued, a chart
//!    without children kept; every kept chart's mean squared stretch is lowered; the atlas's
//!    stretch (the optimal mean squared stretch, or with a signal the largest geometric stretch per
//!    area) is read. Asked for a chart count, the loop stops once it is met after a first round,
//!    and fails when the first round already passes it. While the stretch misses its bound or the
//!    charts are too few, the chart of largest stretch is split in two and its halves queued; the
//!    loop runs until the queue is empty.
//! 3. The small charts merged (`merge`), the charts scaled to their optimal sizes (with a signal,
//!    after optimising the signal stretch against a looser bound). A chart left without a
//!    boundary is a failure.
use super::input::check_stretch;
use crate::hlod::flatten::uv::spectral::criteria::internal_criterion;
use crate::hlod::flatten::uv::spectral::fail::failed;
use crate::hlod::flatten::uv::spectral::merge::merge_small_charts;
use crate::hlod::flatten::uv::spectral::mesh::{Chart, NONE};
use crate::hlod::flatten::uv::spectral::source::Source;
use crate::hlod::flatten::uv::spectral::stretch::{
    best_split_candidate, optimal_l2_mean, optimize_all_l2, reaches_expected,
    recompute_geometric_l2, scale_charts_optimally, widest_geometric_stretch,
};
use trillion3d_math::heap::{Greatest, IndexedHeap};

/// Charts waiting, in the library's heap order.
struct Queue<'a> {
    charts: Vec<Option<Chart<'a>>>,
    heap: IndexedHeap<Greatest>,
}

impl<'a> Queue<'a> {
    fn new() -> Self {
        Queue {
            charts: Vec::new(),
            heap: IndexedHeap::new(0),
        }
    }

    fn push(&mut self, chart: Chart<'a>) {
        self.heap.insert(self.charts.len() as u32, 0.0);
        self.charts.push(Some(chart));
    }

    fn pop(&mut self) -> Option<Chart<'a>> {
        let id = self.heap.pop()?;
        self.charts[id as usize].take()
    }

    fn is_empty(&self) -> bool {
        self.heap.top().is_none()
    }

    /// The children of `chart` queued in order.
    fn push_children(&mut self, chart: &mut Chart<'a>) {
        for child in chart.children.drain(..) {
            self.push(child);
        }
    }
}

/// The initial charts of `root`.
pub(super) fn initial_charts(root: Chart) -> crate::Result<Vec<Chart>> {
    let mut queue = Queue::new();
    queue.push(root);
    let mut initial = Vec::new();
    while let Some(mut chart) = queue.pop() {
        chart.prepare()?;
        if chart.children.is_empty() {
            initial.push(chart);
        } else {
            queue.push_children(&mut chart);
        }
    }
    Ok(initial)
}

/// The charts of `initial` partitioned for at most `max_charts` charts (0 for no bound) and the
/// caller's stretch bound `stretch`.
pub(super) fn partition<'a>(
    source: &'a Source,
    initial: Vec<Chart<'a>>,
    max_charts: usize,
    stretch: f32,
) -> crate::Result<Vec<Chart<'a>>> {
    check_stretch(stretch)?;
    let expected = internal_criterion(stretch, false);
    source.expected_l2.set(expected);
    let signal = source.has_signal();
    let mut queue = Queue::new();
    for chart in initial {
        queue.push(chart);
    }
    let mut charts: Vec<Chart> = Vec::new();
    let mut count_met = false;
    loop {
        while let Some(mut chart) = queue.pop() {
            chart.partition()?;
            if chart.children.is_empty() {
                charts.push(chart);
            } else {
                queue.push_children(&mut chart);
            }
        }
        optimize_all_l2(&mut charts, false);
        let current = if signal {
            widest_geometric_stretch(&mut charts).1
        } else {
            optimal_l2_mean(&charts)
        };
        if max_charts != 0 {
            if count_met && max_charts <= charts.len() {
                break;
            }
            if max_charts < charts.len() && !count_met {
                return Err(failed("the chart bound is too small for the mesh"));
            }
            count_met = true;
        }
        if !reaches_expected(current, expected) || charts.len() < max_charts {
            split_largest(&mut charts, &mut queue, signal)?;
        }
        if queue.is_empty() {
            break;
        }
    }
    if charts.len() > max_charts {
        charts = merge_small_charts(charts, max_charts)?;
    }
    scale_to_optimal(source, &mut charts, stretch);
    if charts
        .iter()
        .any(|c| !c.verts.is_empty() && !c.has_boundary_vertex())
    {
        return Err(failed("a closed surface was left uncut"));
    }
    Ok(charts)
}

/// The chart of largest stretch split in two, its halves queued and the chart dropped; a chart
/// that gives no half stays.
fn split_largest<'a>(
    charts: &mut Vec<Chart<'a>>,
    queue: &mut Queue<'a>,
    signal: bool,
) -> crate::Result<()> {
    let at = if signal {
        widest_geometric_stretch(charts).0
    } else {
        best_split_candidate(charts)
    };
    if at == NONE || at as usize >= charts.len() {
        return Err(failed("no chart left to split"));
    }
    let chart = &mut charts[at as usize];
    chart.split_in_space()?;
    if chart.children.is_empty() {
        return Ok(());
    }
    queue.push_children(chart);
    charts.remove(at as usize);
    Ok(())
}

/// The charts scaled to their optimal sizes.
fn scale_to_optimal(source: &Source, charts: &mut [Chart], stretch: f32) {
    if !source.has_signal() {
        let current = optimal_l2_mean(charts.iter());
        scale_charts_optimally(charts, current, false);
        return;
    }
    source.expected_l2.set(internal_criterion(stretch, true));
    optimize_all_l2(charts, true);
    recompute_geometric_l2(charts);
    let current = optimal_l2_mean(charts.iter());
    scale_charts_optimally(charts, current, true);
}

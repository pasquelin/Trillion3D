//! The small charts merged into their neighbours while the stretch allows.
//!
//! With four charts or more: the charts sorted by face count (the library's exchange sort: each
//! place swapped with every later chart of fewer faces), each chart's neighbours read across the
//! input's adjacency, and a heap of the charts with neighbours and surface area, fewest faces
//! first. Each chart taken from the heap tries its neighbours, those of closest mean normal first,
//! skipping a neighbour gone, of no area, already refused, or whose join would pass 70% of the
//! faces (at least 700): the two are joined (`join`), parameterised (`parameterize`, with
//! `barycentric` and its solver `solve`), their mean squared stretch lowered, and kept when the
//! atlas's optimal mean squared stretch still meets the bound. The joined chart takes the first
//! chart's place (its neighbours pointed to it) and goes back into the heap; a chart that joined
//! none is refused from then on. At most as many joins as charts above the count asked for, when
//! one is asked for.
use super::mesh::Chart;
use super::ranked::Ranked;
use super::stretch::{optimal_l2_mean, reaches_expected};
use super::util::{push_unique, remove_all, unit};
use trillion3d_math::vector::vecn::{add, dot, scale};

mod barycentric;
mod join;
mod parameterize;
mod solve;

/// The heap keys count faces down from this.
const MAX_FACE_COUNT: usize = 0xffff_fffe;
/// The share of the input's faces a joined chart may hold.
const MAX_MERGE_RATIO: f32 = 0.7;
/// The faces a joined chart may hold whatever the input's size.
const MAX_MERGE_FACES: f32 = 700.0;

/// `charts` with their small charts merged, at most down to `wanted` charts when not zero.
pub(crate) fn merge_small_charts(
    mut charts: Vec<Chart<'_>>,
    wanted: usize,
) -> crate::Result<Vec<Chart<'_>>> {
    if charts.len() < 4 {
        return Ok(charts);
    }
    for i in 0..charts.len() - 1 {
        for j in i + 1..charts.len() {
            if charts[i].faces.len() > charts[j].faces.len() {
                charts.swap(i, j);
            }
        }
    }
    find_chart_neighbours(&mut charts);
    let mut normals: Vec<[f32; 3]> = charts.iter().map(mean_normal).collect();
    let mut heap = Ranked::<u32>::new(charts.len());
    for (i, chart) in charts.iter().enumerate() {
        if !chart.neighbours.is_empty() && chart.area_3d != 0.0 {
            heap.insert(i as u32, (MAX_FACE_COUNT - chart.faces.len()) as u32);
        }
    }
    let mut slots: Vec<Option<Chart>> = charts.into_iter().map(Some).collect();
    merge_slots(&mut slots, &mut heap, &mut normals, wanted)?;
    Ok(slots.into_iter().flatten().collect())
}

/// Each chart's neighbours: the charts of the faces across its faces' edges in the input.
fn find_chart_neighbours(charts: &mut [Chart]) {
    let source = charts[0].source;
    let mut chart_of = vec![0u32; source.face_count];
    for (i, chart) in charts.iter().enumerate() {
        for face in &chart.faces {
            chart_of[face.root as usize] = i as u32;
        }
    }
    for (i, chart) in charts.iter_mut().enumerate() {
        chart.neighbours.clear();
        for f in 0..chart.faces.len() {
            let root = chart.faces[f].root as usize;
            for &across in &source.given_adjacency[3 * root..3 * root + 3] {
                if across != u32::MAX && chart_of[across as usize] != i as u32 {
                    push_unique(&mut chart.neighbours, chart_of[across as usize]);
                }
            }
        }
    }
}

/// A chart's mean normal: its faces' normals weighed by their areas, made of unit length.
fn mean_normal(chart: &Chart) -> [f32; 3] {
    let source = chart.source;
    let sum = (chart.faces.iter()).fold([0.0; 3], |sum, f| {
        add(
            sum,
            scale(
                source.normals[f.root as usize],
                source.areas[f.root as usize],
            ),
        )
    });
    unit(sum)
}

/// The merging of the charts in `slots` (a joined chart's second one leaves its slot empty), from
/// the heap `heap` of their places and their mean normals `normals`.
fn merge_slots(
    slots: &mut [Option<Chart>],
    heap: &mut Ranked<u32>,
    normals: &mut [[f32; 3]],
    wanted: usize,
) -> crate::Result<()> {
    let count = slots.len();
    let mut joins_left = if wanted != 0 && wanted < count {
        count - wanted
    } else {
        MAX_FACE_COUNT
    };
    let mut open = vec![true; count];
    while let Some(index) = heap.pop() {
        let index = index as usize;
        if slots[index].is_none() || !merge_into_neighbour(slots, index, &mut open, normals)? {
            continue;
        }
        let faces = slots[index].as_ref().map_or(0, |c| c.faces.len());
        heap.insert(index as u32, (MAX_FACE_COUNT - faces) as u32);
        joins_left -= 1;
        if joins_left == 0 {
            break;
        }
    }
    Ok(())
}

/// Chart `main` joined with the first neighbour that keeps the stretch bound; whether it was.
fn merge_into_neighbour(
    slots: &mut [Option<Chart>],
    main: usize,
    open: &mut [bool],
    normals: &mut [[f32; 3]],
) -> crate::Result<bool> {
    let Some(chart) = slots[main].as_ref() else {
        return Ok(false);
    };
    let mut neighbours = chart.neighbours.clone();
    let n = neighbours.len();
    if n == 0 {
        return Ok(false);
    }
    for i in 0..n - 1 {
        if slots[neighbours[i] as usize].is_none() {
            continue;
        }
        for j in i + 1..n {
            if slots[neighbours[j] as usize].is_none() {
                continue;
            }
            let first = dot(normals[main], normals[neighbours[i] as usize]);
            let second = dot(normals[main], normals[neighbours[j] as usize]);
            if first < second {
                neighbours.swap(i, j);
            }
        }
    }
    let total_faces = chart.source.face_count;
    let limit = ((total_faces as f32 * MAX_MERGE_RATIO) as usize).max(MAX_MERGE_FACES as usize);
    let main_faces = chart.faces.len();
    if let Some(chart) = slots[main].as_mut() {
        chart.neighbours = neighbours.clone();
    }
    let mut merged = None;
    for &other in &neighbours {
        let other = other as usize;
        if !open[other] {
            continue;
        }
        let Some(candidate) = slots[other].as_ref() else {
            continue;
        };
        if candidate.area_3d == 0.0 || main_faces + candidate.faces.len() > limit {
            continue;
        }
        let Some(mut joined) = join::try_join(slots, main, other)? else {
            continue;
        };
        if !joined.try_parameterize()? {
            continue;
        }
        joined.optimize_l2(false);
        let kept = slots
            .iter()
            .enumerate()
            .filter(|&(i, _)| i != main && i != other)
            .filter_map(|(_, c)| c.as_ref());
        let mean = optimal_l2_mean(kept.chain([&joined]));
        if reaches_expected(mean, joined.source.expected_l2.get()) {
            merged = Some((joined, other));
            break;
        }
    }
    let Some((joined, other)) = merged else {
        open[main] = false;
        return Ok(false);
    };
    for &n in &joined.neighbours {
        if let Some(chart) = slots[n as usize].as_mut() {
            remove_all(&mut chart.neighbours, other as u32);
            push_unique(&mut chart.neighbours, main as u32);
        }
    }
    slots[other] = None;
    normals[main] = mean_normal(&joined);
    slots[main] = Some(joined);
    Ok(true)
}

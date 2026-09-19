use super::{PROXY_ERROR_METRES, PROXY_TRIANGLE_FLOATS};
use crate::dag::DagCluster;

/// Threshold doublings a cut allows before giving up: the sixteenth is 65536× the
/// first, i.e. the DAG roots beyond which nothing coarser exists. A known bound,
/// not a loop that stops when it feels like it.
const ERROR_LADDER: usize = 16;

/// Clusters of a flat cut at the given threshold: certified error under the
/// threshold, replacement above.
///
/// Exactly the cut engine uses for screen, threshold in meters instead of pixels:
/// `lod_error <= t < parent_error`. Both monotonic along DAG, so rule
/// covers surface once and once only — no hole, no double layer. A root has infinite
/// `parent_error`: retained as soon as error exceeds threshold, otherwise
/// children are retained because replacement is precisely this coarse root.
fn selected(cluster: &DagCluster, threshold: f64) -> bool {
    cluster.lod_error <= threshold && cluster.parent_error > threshold
}

fn triangles_at(dag: &[DagCluster], threshold: f64) -> usize {
    dag.iter()
        .filter(|cluster| selected(cluster, threshold))
        .map(DagCluster::triangles)
        .sum()
}

/// What primitive requests from cut: error threshold and fraction of triangle budget.
#[derive(Clone, Copy)]
pub struct CutDemand {
    /// Starting threshold in object space: caller mapped it by world scale.
    pub threshold: f64,
    /// Triangles this primitive allows itself in scene proxy.
    pub budget: usize,
}

/// Finest cut fitting triangle budget, and requested threshold.
///
/// Starting threshold is spec threshold in meters; as long as cut exceeds budget share,
/// it doubles — stops doubling when it removes nothing, because DAG roots
/// are a floor that proxy simplification will cross, not cut.
///
/// Generic size rule, no scene name: primitive drawn 1000 times
/// receives 1000x smaller share and comes out 1000x coarser, small part keeps
/// starting threshold. Actually obtained threshold published.
///
/// Threshold expressed in object space: caller divided it by largest world scale of
/// node placing primitive, so it equals meters once cut is placed.
pub fn coarse_cut(dag: &[DagCluster], positions: &[f32], demand: CutDemand) -> (f64, Vec<f32>) {
    let mut threshold = demand.threshold;
    let mut triangles = triangles_at(dag, threshold);
    for _ in 0..ERROR_LADDER {
        if triangles <= demand.budget {
            break;
        }
        let wider = threshold * 2.0;
        let fewer = triangles_at(dag, wider);
        // DAG has floor: its roots. Threshold removing no triangles serves
        // only to publish error cut never took; proxy-specific simplification
        // goes lower. Stop at the smallest threshold that reaches the floor, and
        // publish that one.
        if fewer >= triangles {
            break;
        }
        threshold = wider;
        triangles = fewer;
    }
    let mut out: Vec<f32> = Vec::with_capacity(triangles * PROXY_TRIANGLE_FLOATS);
    for cluster in dag.iter().filter(|cluster| selected(cluster, threshold)) {
        for index in &cluster.indices {
            let base = *index as usize * 3;
            // Cluster names source vertices: index past buffer is invalid
            // partition, compiler already refused before reaching here.
            out.push(positions[base]);
            out.push(positions[base + 1]);
            out.push(positions[base + 2]);
        }
    }
    (threshold, out)
}

/// What primitive requests from cut, calculated once per primitive.
///
/// Published world threshold mapped to object space by largest scale placing
/// primitive — missing or zero scale leaves as is, nothing guessed. Share is
/// proportional to primitive weight in scene once all instances placed:
/// instance factor cancels out, since 1000-instance primitive weighs 1000x more and
/// per-instance share is 1000x smaller. Never less than one cluster: nothing
/// disappears from proxy, even in 100,000 object scene.
pub fn cut_demand(
    scale: Option<f64>,
    budget: usize,
    triangles: usize,
    scene_triangles: usize,
) -> CutDemand {
    let threshold = match scale {
        Some(value) if value.is_finite() && value > 0.0 => PROXY_ERROR_METRES / value,
        _ => PROXY_ERROR_METRES,
    };
    let share = if scene_triangles == 0 {
        budget
    } else {
        (budget as u128 * triangles as u128 / scene_triangles as u128) as usize
    };
    CutDemand {
        threshold,
        budget: share.max(crate::dag::DAG_CLUSTER_TRIANGLES),
    }
}

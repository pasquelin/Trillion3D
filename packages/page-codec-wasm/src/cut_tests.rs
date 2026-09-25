use super::*;
use crate::cut_error::PLANE_VALUES;

/// Six planes `0·x + 0·y + 0·z + 1`: every box lies entirely inside.
fn lens(pixel_error: f64) -> Lens {
    let mut planes = [0.0; PLANE_VALUES];
    for p in planes.as_chunks_mut::<4>().0 {
        p[3] = 1.0;
    }
    let mut view = [0.0; 16];
    for i in 0..4 {
        view[i * 5] = 1.0;
    }
    view[14] = -10.0;
    Lens {
        planes,
        view,
        stretch: 1.0,
        focal: 1000.0,
        near: 0.1,
        perspective: 1.0,
        pixel_error,
        exact: false,
    }
}

/// A root and two leaf children; every subtree accepted, so the children arrive settled.
fn tree() -> (Vec<f64>, Vec<f64>) {
    let mut nodes = vec![0.0; 3 * MIN_STRIDE];
    let mut bounds = vec![0.0; 3 * BOUND_STRIDE];
    for n in 0..3 {
        let b = n * MIN_STRIDE;
        nodes[b..b + 6].copy_from_slice(&[-1.0, -1.0, -1.0, 1.0, 1.0, 1.0]);
        nodes[b + 10] = -1.0;
        nodes[b + 14] = 1.0;
        let a = n * BOUND_STRIDE;
        bounds[a + 2] = f64::INFINITY;
        bounds[a + 6] = 1.0;
        bounds[a + 10] = 1.0;
    }
    nodes[11] = 1.0;
    nodes[12] = 2.0;
    (nodes, bounds)
}

fn run(
    nodes: &[f64],
    bounds: &[f64],
    l: &Lens,
    stack_len: usize,
) -> Result<(Walk, Vec<u32>), Bail> {
    run_open(nodes, bounds, &[], l, stack_len)
}

fn run_open(
    nodes: &[f64],
    bounds: &[f64],
    open: &[u32],
    l: &Lens,
    stack_len: usize,
) -> Result<(Walk, Vec<u32>), Bail> {
    let (mut stack, mut leaves) = (vec![0; stack_len], vec![0; 4]);
    let w = walk(nodes, MIN_STRIDE, bounds, open, l, &mut stack, &mut leaves)?;
    Ok((w, leaves[..w.leaves].to_vec()))
}

#[test]
fn leaves_in_stack_order_with_their_flags() {
    let (nodes, bounds) = tree();
    let (w, leaves) = run(&nodes, &bounds, &lens(1.0), 8).unwrap();
    assert_eq!(leaves, vec![2 << 2 | 3, 1 << 2 | 3]);
    assert_eq!((w.nodes_tested, w.frustum_rejected), (1, 0));
}

#[test]
fn a_node_popped_twice_bails() {
    let (mut nodes, bounds) = tree();
    nodes[MIN_STRIDE + 11] = 0.0;
    nodes[MIN_STRIDE + 12] = 1.0;
    assert_eq!(run(&nodes, &bounds, &lens(1.0), 8), Err(Bail));
}

#[test]
fn a_full_stack_bails() {
    let (nodes, bounds) = tree();
    assert_eq!(run(&nodes, &bounds, &lens(1.0), 1), Err(Bail));
}

#[test]
fn a_refused_projection_bails() {
    let (nodes, mut bounds) = tree();
    bounds[1] = f64::NAN;
    assert_eq!(run(&nodes, &bounds, &lens(1.0), 8), Err(Bail));
}

#[test]
fn exact_threshold_decides_without_projecting() {
    let (nodes, mut bounds) = tree();
    for n in 0..3 {
        bounds[n * BOUND_STRIDE + 1] = f64::NAN;
    }
    let mut l = lens(0.0);
    l.exact = true;
    // A NaN ceiling is "not zero" at the exact threshold: undecided, never refused.
    let (w, leaves) = run(&nodes, &bounds, &l, 8).unwrap();
    assert_eq!(leaves, vec![2 << 2 | 1, 1 << 2 | 1]);
    assert_eq!(w.nodes_tested, 3);
}

#[test]
fn an_open_subtree_is_descended_past_its_floor() {
    let (nodes, mut bounds) = tree();
    // An own floor far above the threshold: every node rejects its subtree.
    for n in 0..3 {
        bounds[n * BOUND_STRIDE] = 1e9;
    }
    let (w, leaves) = run(&nodes, &bounds, &lens(1.0), 8).unwrap();
    assert_eq!((leaves.len(), w.nodes_tested), (0, 1));
    // The second leaf holds a cluster whose finer group is not resident, and so does the root.
    let (w, leaves) = run_open(&nodes, &bounds, &[1, 0, 1], &lens(1.0), 8).unwrap();
    assert_eq!(leaves, vec![2 << 2 | 1]);
    assert_eq!(w.nodes_tested, 3);
    // An open list shorter than the hierarchy is outside the domain.
    assert_eq!(run_open(&nodes, &bounds, &[1], &lens(1.0), 8), Err(Bail));
}

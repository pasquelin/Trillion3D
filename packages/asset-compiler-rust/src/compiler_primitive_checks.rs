//! What a primitive's DAG must prove before the cook publishes it: level 0 is exactly the source
//! triangles, and errors never drop from a cluster to its parent (`dag::quality`).
use super::*;
use crate::dag::DagCluster;

pub(super) fn check_dag(dag: &[DagCluster], index_values: &[u32]) -> Result<()> {
    let level0 = || dag.iter().filter(|c| c.level == 0);
    if level0().map(|c| c.triangles()).sum::<usize>() != index_values.len() / 3 {
        return Err(CompilerError::new(
            "INCOMPLETE_CLUSTER_PARTITION",
            "Level 0 clusters do not cover the source triangles",
        ));
    }
    if triangle_fingerprint(triangles(index_values))
        != triangle_fingerprint(level0().flat_map(|c| triangles(&c.indices)))
    {
        return Err(CompilerError::new(
            "INVALID_CLUSTER_PARTITION",
            "Level 0 clusters are not the source triangles",
        ));
    }
    crate::dag::quality::check(dag)
}

fn triangles(indices: &[u32]) -> impl Iterator<Item = &[u32]> {
    indices.as_chunks::<3>().0.iter().map(|tri| tri.as_slice())
}

/// An order-free fingerprint of a triangle set: each triangle's sorted corners hashed, the hashes
/// summed, so two lists of the same triangles in any order and rotation agree.
pub(crate) fn triangle_fingerprint<'a>(triangles: impl Iterator<Item = &'a [u32]>) -> u64 {
    let mut total = 0u64;
    for tri in triangles {
        let mut corners = [tri[0], tri[1], tri[2]];
        corners.sort_unstable();
        let mut hash = trillion3d_math::GOLDEN;
        for corner in corners {
            hash = (hash ^ corner as u64).wrapping_mul(0x100_0000_01b3);
            hash ^= hash >> 29;
        }
        total = total.wrapping_add(hash);
    }
    total
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dag::{build_dag, DagAttributes, DagStrategy};

    /// A gently waved sheet and the DAG the compiler builds of it.
    fn sheet() -> (Vec<u32>, Vec<DagCluster>) {
        let n = 48usize;
        let mut positions = Vec::new();
        for y in 0..=n {
            for x in 0..=n {
                let (fx, fy) = (x as f32, y as f32);
                positions.extend([fx, fy, (fx * 0.31).sin() * (fy * 0.27).cos() * 0.5]);
            }
        }
        let indices = crate::tests::fixtures::grid_indices(n, n, |x, y| (y * (n + 1) + x) as u32);
        let dag = build_dag(
            &positions,
            DagAttributes::default(),
            &indices,
            DagStrategy::QemEndpoints,
            &|| Ok(()),
        )
        .expect("dag")
        .clusters;
        (indices, dag)
    }

    // Behaviour: a cook whose parent error drops below its child's is refused.
    #[test]
    fn a_cook_with_a_non_monotone_error_is_refused() {
        let (indices, mut dag) = sheet();
        check_dag(&dag, &indices).expect("sound");
        let child = dag
            .iter()
            .position(|c| !c.is_root())
            .expect("a replaced cluster");
        dag[child].lod_error = dag[child].parent_error * 2.0 + 1.0;
        let refusal = check_dag(&dag, &indices).expect_err("refused");
        assert_eq!(refusal.code, "DAG_ERROR_NOT_MONOTONE");
    }
}

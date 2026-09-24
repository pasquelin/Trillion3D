//! What a primitive's DAG must prove before the cook publishes it: level 0 is exactly the source
//! triangles, errors never drop from a cluster to its parent, and no coarse level bends a normal
//! past its bound (`dag::quality`). Returns the per-level quality the report publishes.
use super::*;
use crate::dag::quality::LevelQuality;
use crate::dag::DagCluster;

pub(super) fn check_dag(
    dag: &[DagCluster],
    pos: &[f32],
    normals: Option<&[f32]>,
    index_values: &[u32],
) -> Result<Vec<LevelQuality>> {
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
    crate::dag::quality::check(dag, pos, normals)
}

fn triangles(indices: &[u32]) -> impl Iterator<Item = &[u32]> {
    indices.as_chunks::<3>().0.iter().map(|tri| tri.as_slice())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dag::{build_dag_tallied, DagAttributes, DagStrategy};
    use crate::geometry_page::{Attribute, FLAG_NORMAL};

    /// A gently waved sheet facing up with its up normals, and the DAG the compiler builds of it;
    /// the source triangle `inverted`, if any, winds the other way.
    fn sheet(inverted: Option<usize>) -> (Vec<f32>, Vec<f32>, Vec<u32>, Vec<DagCluster>) {
        let n = 48usize;
        let mut positions = Vec::new();
        for y in 0..=n {
            for x in 0..=n {
                let (fx, fy) = (x as f32, y as f32);
                positions.extend([fx, fy, (fx * 0.31).sin() * (fy * 0.27).cos() * 0.5]);
            }
        }
        let mut indices =
            crate::tests::fixtures::grid_indices(n, n, |x, y| (y * (n + 1) + x) as u32);
        if let Some(t) = inverted {
            indices.swap(t * 3 + 1, t * 3 + 2);
        }
        let normals = [0.0, 0.0, 1.0].repeat(positions.len() / 3);
        let attribute = Attribute {
            flag: FLAG_NORMAL,
            width: 3,
            values: normals.clone(),
        };
        let carried = [&attribute];
        let (dag, ..) = build_dag_tallied(
            &positions,
            DagAttributes { carried: &carried },
            &indices,
            DagStrategy::QemEndpoints,
            &|| Ok(()),
        )
        .expect("dag");
        (positions, normals, indices, dag)
    }

    // Behaviour: the cook publishes one quality row per level of a sound DAG.
    #[test]
    fn a_sound_dag_is_published_with_its_quality_per_level() {
        let (positions, normals, indices, dag) = sheet(None);
        let quality = check_dag(&dag, &positions, Some(&normals), &indices).expect("sound");
        let depth = dag.iter().map(|c| c.level).max().unwrap_or(0);
        assert!(depth > 1);
        assert_eq!(quality.len(), depth + 1);
        let (report, _) = super::super::compiler_primitive_stalls::dag_report(
            DagStrategy::QemEndpoints,
            &dag,
            &[],
            &[],
            &quality,
        );
        for row in report["levels"].as_array().expect("levels") {
            assert!(row["normalDeviationMax"].as_f64().is_some(), "{row}");
        }
    }

    // Behaviour: a cook whose parent error drops below its child's is refused.
    #[test]
    fn a_cook_with_a_non_monotone_error_is_refused() {
        let (positions, normals, indices, mut dag) = sheet(None);
        let child = dag
            .iter()
            .position(|c| !c.is_root())
            .expect("a replaced cluster");
        dag[child].lod_error = dag[child].parent_error * 2.0 + 1.0;
        let refusal = check_dag(&dag, &positions, Some(&normals), &indices).expect_err("refused");
        assert_eq!(refusal.code, "DAG_ERROR_NOT_MONOTONE");
    }

    // Behaviour: a cook whose coarse level shades its faces from behind is refused.
    #[test]
    fn a_cook_with_a_backlit_level_is_refused() {
        let (positions, normals, indices, mut dag) = sheet(None);
        for cluster in dag.iter_mut().filter(|c| c.level > 0) {
            for tri in cluster.indices.as_chunks_mut::<3>().0 {
                tri.swap(1, 2);
            }
        }
        let refusal = check_dag(&dag, &positions, Some(&normals), &indices).expect_err("refused");
        assert_eq!(refusal.code, "DAG_NORMAL_DEVIATION");
    }

    // Behaviour: one inverted source triangle raises the bound of its own group only, so a
    // coarse cluster elsewhere shaded from behind is still refused. The inverted triangle keeps
    // up normals (over 170°); every other vertex leans 30°, so the backlit cluster stays under it
    // and a primitive-wide bound would let it through.
    #[test]
    fn an_inverted_source_triangle_does_not_excuse_a_backlit_group_elsewhere() {
        let (positions, _, indices, mut dag) = sheet(Some(0));
        let inverted = &indices[..3];
        let normals: Vec<f32> = (0..positions.len() as u32 / 3)
            .flat_map(|v| match inverted.contains(&v) {
                true => [0.0, 0.0, 1.0],
                false => [0.5, 0.0, 0.866],
            })
            .collect();
        let holder = dag
            .iter()
            .find(|c| c.level == 0 && c.indices.chunks(3).any(|tri| tri == inverted))
            .expect("the inverted triangle is at level 0");
        let source =
            crate::dag::quality::normal_deviation(&holder.indices, &positions, &normals, 0.0);
        let its_group = holder.group;
        let elsewhere = dag
            .iter_mut()
            .find(|c| {
                c.level == 1
                    && c.source != its_group
                    && !c.indices.iter().any(|v| inverted.contains(v))
            })
            .expect("a level 1 cluster of another group");
        for tri in elsewhere.indices.as_chunks_mut::<3>().0 {
            tri.swap(1, 2);
        }
        let backlit = crate::dag::quality::normal_deviation(
            &elsewhere.indices,
            &positions,
            &normals,
            elsewhere.lod_error,
        );
        assert!(
            90.0 < backlit && backlit < source,
            "{backlit} under {source}"
        );
        let refusal = check_dag(&dag, &positions, Some(&normals), &indices).expect_err("refused");
        assert_eq!(refusal.code, "DAG_NORMAL_DEVIATION");
    }
}

use super::*;

#[test]
fn every_group_owns_its_children_and_its_coarse_replacement() {
    let (positions, indices) = grid(160);
    let (dag, groups, _) =
        build_dag_tallied(&positions, &indices, DagStrategy::QemEndpoints, &|| Ok(()))
            .expect("dag");
    assert!(!groups.is_empty());
    let mut owned = vec![0usize; dag.len()];
    let mut produced = vec![0usize; dag.len()];
    for (index, group) in groups.iter().enumerate() {
        assert!(!group.children.is_empty() && !group.outputs.is_empty());
        for &child in &group.children {
            owned[child] += 1;
            assert_eq!(
                dag[child].group,
                Some(index),
                "a cluster must name the group that replaces it"
            );
            assert_eq!(dag[child].parent_error, group.error);
            assert_eq!(dag[child].parent_sphere, group.sphere);
        }
        for &output in &group.outputs {
            produced[output] += 1;
            assert_eq!(
                dag[output].lod_error, group.error,
                "an output carries the error of the group that made it"
            );
            assert_eq!(dag[output].sphere, group.sphere);
            assert_eq!(dag[output].level, group.level);
            assert_eq!(
                dag[output].source,
                Some(index),
                "an output must name the group that made it"
            );
        }
    }
    for (index, cluster) in dag.iter().enumerate() {
        assert_eq!(
            owned[index],
            if cluster.is_root() { 0 } else { 1 },
            "a cluster belongs to exactly one group unless it is a root"
        );
        assert!(
            produced[index] <= 1,
            "a cluster is produced by at most one group"
        );
        assert_eq!(
            produced[index] == 0,
            cluster.level == 0,
            "only level 0 has no producing group"
        );
    }
}

#[test]
fn a_group_and_its_replacement_cover_the_same_triangles_once() {
    // Fallback safety: swapping a group's children for its outputs must not leave or duplicate area.
    let (positions, indices) = grid(160);
    let (dag, groups, _) =
        build_dag_tallied(&positions, &indices, DagStrategy::QemEndpoints, &|| Ok(()))
            .expect("dag");
    let area = |ids: &[u32]| -> f64 {
        ids.as_chunks::<3>()
            .0
            .iter()
            .map(|tri| {
                let p = |id: u32| {
                    let i = id as usize * 3;
                    [
                        positions[i] as f64,
                        positions[i + 1] as f64,
                        positions[i + 2] as f64,
                    ]
                };
                let (a, b, c) = (p(tri[0]), p(tri[1]), p(tri[2]));
                let u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
                let v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
                let n = [
                    u[1] * v[2] - u[2] * v[1],
                    u[2] * v[0] - u[0] * v[2],
                    u[0] * v[1] - u[1] * v[0],
                ];
                (n[0] * n[0] + n[1] * n[1] + n[2] * n[2]).sqrt() / 2.0
            })
            .sum()
    };
    for group in &groups {
        let fine: f64 = group
            .children
            .iter()
            .map(|&id| area(&dag[id].indices))
            .sum();
        let coarse: f64 = group.outputs.iter().map(|&id| area(&dag[id].indices)).sum();
        assert!(fine > 0.0 && coarse > 0.0);
        // A planar-ish sheet keeps its area; a curved one loses a little to the flattening.
        assert!(
            coarse <= fine * 1.05 && coarse >= fine * 0.80,
            "group area {fine} became {coarse}"
        );
    }
}

#[test]
fn a_planar_sheet_keeps_its_exact_level_and_coarsens_without_error() {
    // A plane simplifies losslessly, so every level shares error zero; level 0 must still be emitted.
    let w = 65usize;
    let positions: Vec<f32> = (0..w)
        .flat_map(|y| (0..w).flat_map(move |x| [x as f32, y as f32, 0.0]))
        .collect();
    let mut indices = Vec::new();
    for y in 0..(w - 1) as u32 {
        for x in 0..(w - 1) as u32 {
            let a = y * w as u32 + x;
            indices.extend([
                a,
                a + 1,
                a + w as u32,
                a + 1,
                a + 1 + w as u32,
                a + w as u32,
            ]);
        }
    }
    let (dag, _, _) =
        build_dag_tallied(&positions, &indices, DagStrategy::QemEndpoints, &|| Ok(()))
            .expect("dag");
    let leaves: usize = dag
        .iter()
        .filter(|c| c.level == 0)
        .map(|c| c.triangles())
        .sum();
    assert_eq!(
        leaves,
        indices.len() / 3,
        "level 0 must keep the exact cover even when every error is zero"
    );
    assert!(
        dag.iter().any(|c| c.level > 0),
        "a plane must still coarsen"
    );
    assert!(dag
        .iter()
        .all(|c| c.lod_error == 0.0 || !c.lod_error.is_finite()));
}

#[test]
fn build_honours_cancellation() {
    let (positions, indices) = grid(32);
    let error = build_dag_tallied(&positions, &indices, DagStrategy::QemEndpoints, &|| {
        Err(invalid("cancelled"))
    })
    .expect_err("cancelled");
    assert!(error.to_string().contains("cancelled"));
}

//! A block's window panes: hundreds of disjoint thin boxes on the four faces of a building, the
//! glass of a code-modelled district (`long-district`). No pane shares a vertex with another, so
//! no group has a border to hold, and every pane is a closed solid the halving can only drop.
use super::*;
use trillion3d_page_codec::encode::Attribute;
use trillion3d_page_codec::FLAG_NORMAL;

/// An axis box of `size` centred on `centre`: six faces of four corners, each corner carrying its
/// face's normal, as a modelled box is written.
fn pane(
    centre: [f32; 3],
    size: [f32; 3],
    positions: &mut Vec<f32>,
    normals: &mut Vec<f32>,
    indices: &mut Vec<u32>,
) {
    for axis in 0..3 {
        for side in [-1.0f32, 1.0] {
            let (u, v) = ((axis + 1) % 3, (axis + 2) % 3);
            let base = (positions.len() / 3) as u32;
            for (du, dv) in [(-1.0, -1.0), (1.0, -1.0), (1.0, 1.0), (-1.0, 1.0)] {
                let mut corner = centre;
                corner[axis] += side * size[axis] / 2.0;
                corner[u] += du * size[u] / 2.0;
                corner[v] += dv * size[v] / 2.0;
                positions.extend(corner);
                let mut normal = [0.0; 3];
                normal[axis] = side;
                normals.extend(normal);
            }
            let quad = if side > 0.0 {
                [0, 1, 2, 0, 2, 3]
            } else {
                [0, 2, 1, 0, 3, 2]
            };
            indices.extend(quad.map(|k| base + k));
        }
    }
}

/// The glass of a block `width` by `depth` with `floors` storeys: one pane every three metres of
/// each face, on every floor, a few centimetres proud of the wall.
fn panes(width: f32, depth: f32, floors: usize) -> (Vec<f32>, Vec<f32>, Vec<u32>) {
    let (mut positions, mut normals, mut indices) = (Vec::new(), Vec::new(), Vec::new());
    for (span, half, along_z) in [(width, depth / 2.0, true), (depth, width / 2.0, false)] {
        let columns = ((span / 3.0).floor() as usize).max(1);
        for out in [-1.0f32, 1.0] {
            for floor in 0..floors {
                for column in 0..columns {
                    let u = -span / 2.0 + span / columns as f32 * (column as f32 + 0.5);
                    let y = 4.2 + floor as f32 * 3.2 + 1.7;
                    let w = out * (half + 0.07);
                    let (centre, size) = match along_z {
                        true => ([u, y, w], [1.3, 1.7, 0.03]),
                        false => ([w, y, u], [0.03, 1.7, 1.3]),
                    };
                    pane(centre, size, &mut positions, &mut normals, &mut indices);
                }
            }
        }
    }
    (positions, normals, indices)
}

// Behaviour: a block's panes climb to a single root, every level fewer triangles than the one
// below, every cluster carrying a finite error band through a sound sphere, no group stalled.
#[test]
fn the_panes_of_a_block_climb_to_one_root_with_every_band_written() {
    for (width, depth, floors) in [(18.0, 16.0, 4), (30.0, 19.0, 18)] {
        let (positions, normals, indices) = panes(width, depth, floors);
        let normals = Attribute {
            flag: FLAG_NORMAL,
            width: 3,
            values: normals,
        };
        let carried = [&normals];
        let attributes = DagAttributes { carried: &carried };
        let strategy = DagStrategy::QemEndpoints;
        let built = build_dag(&positions, attributes, &indices, strategy, &|| Ok(())).expect("dag");
        let (dag, stalls) = (built.clusters, built.stalls);
        let case = format!("{width}x{depth}, {floors} floors");
        assert!(stalls.is_empty(), "{case}: {stalls:?}");
        // One root cluster, halved at encode when over the vertex cap (`constrain_wide`): the
        // halves share its group, level and error and draw at most one cluster's triangles.
        let roots: Vec<&DagCluster> = dag.iter().filter(|c| c.is_root()).collect();
        let one = match roots[..] {
            [_] => true,
            [a, b] => {
                (a.source, a.level, a.lod_error) == (b.source, b.level, b.lod_error)
                    && a.indices.len() + b.indices.len() <= 3 * DAG_CLUSTER_TRIANGLES
            }
            _ => false,
        };
        assert!(one, "{case}: {} roots", roots.len());
        for cluster in &dag {
            let [x, y, z, r] = cluster.sphere;
            assert!(
                cluster.lod_error.is_finite() && cluster.lod_error >= 0.0,
                "{case}"
            );
            assert!(
                [x, y, z, r].iter().all(|v| v.is_finite()) && r >= 0.0,
                "{case}"
            );
        }
        let depth_reached = dag.iter().map(|c| c.level).max().unwrap_or(0);
        let per_level: Vec<usize> = (0..=depth_reached)
            .map(|level| {
                dag.iter()
                    .filter(|c| c.level == level)
                    .map(|c| c.triangles())
                    .sum()
            })
            .collect();
        assert_eq!(per_level[0], indices.len() / 3, "{case}");
        assert!(
            per_level.windows(2).all(|w| w[1] < w[0]),
            "{case}: {per_level:?}"
        );
    }
}

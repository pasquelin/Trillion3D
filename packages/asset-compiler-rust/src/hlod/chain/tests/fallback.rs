//! The `lowest` LOD a merged layer takes of a source: its fallback, the source simplified to an
//! error of a hundredth of the source's size, the square root of the smaller of twice its level-0
//! area and a quarter of its box's surface, stopping at 256 triangles at the latest. On generated
//! plates.
use super::attributes::vertex_normals;
use super::plate;
use crate::dag::{build_dag, DagAttributes, DagStrategy, Grown};
use crate::hlod::chain::{Instance, SourceCover};
use crate::hlod::flatten::merge::{merged, Taken};
use crate::simplify::SolveRules;
use crate::HlodLodSelection;
use trillion3d_math::matrix::translation;
use trillion3d_math::vector::vecn::length;
use trillion3d_page_codec::encode::Attribute;
use trillion3d_page_codec::{FLAG_NORMAL, FLAG_UV};

/// The cover of `positions` and `indices` carrying `carried`, its fallback asked for.
fn cover(positions: &[f32], indices: &[u32], carried: &[Attribute]) -> SourceCover {
    let refs: Vec<&Attribute> = carried.iter().collect();
    let attributes = DagAttributes { carried: &refs };
    let strategy = DagStrategy::QemEndpoints;
    let built = build_dag(positions, attributes, indices, strategy, &|| Ok(())).expect("dag");
    let (dag, grown) = ((&built.clusters[..], &built.groups[..]), built.grown);
    let (pos, carried) = Grown::arrays(&grown, positions, attributes);
    let taken = Taken {
        calculate: None,
        lowest: true,
    };
    let asked = Some((taken, SolveRules::default()));
    SourceCover::of(strategy, dag, (pos, &carried), asked).expect("cover")
}

/// The geometry a merged layer takes of `cover` at its `lowest` LOD, placed where it lies.
fn lowest(cover: &SourceCover) -> crate::hlod::flatten::merge::Geometry {
    let instance = Instance {
        hlod: 0,
        material: Some(0),
        matrix: translation([0.0, 0.0, 0.0]),
        cover,
        instanced: false,
        node: 0,
        mesh: 0,
        track: None,
    };
    let cut = (HlodLodSelection::Lowest, 0.25);
    let parts = merged(&[instance], &[0], (cut, None));
    parts.into_iter().next().expect("a part").geometry
}

// Behaviour: a source of at most 256 triangles is under the simplification's limit: its fallback
// is the source, one cluster or two.
#[test]
fn a_source_of_at_most_256_triangles_is_its_own_fallback() {
    for n in [8, 11] {
        let (positions, indices) = plate(n, 4.0, false);
        let (_, _, taken) = lowest(&cover(&positions, &indices, &[]));
        assert_eq!(taken.len(), indices.len(), "a plate of {n} × {n} quads");
    }
}

// Behaviour: a denser source is simplified: its fallback holds fewer triangles than it, never
// under the 64 the cut asks.
#[test]
fn the_fallback_of_a_dense_source_is_simplified() {
    let (positions, indices) = plate(40, 12.0, false);
    let (_, _, taken) = lowest(&cover(&positions, &indices, &[]));
    let kept = taken.len() / 3;
    assert!(kept >= 64, "{kept} triangles");
    assert!(kept < indices.len() / 3, "{kept} triangles");
}

// Behaviour: the fallback carries every attribute its source carries, one value set on each of its
// vertices, the normals unit.
#[test]
fn a_fallback_carries_every_attribute_of_its_source_on_each_vertex() {
    let size = 12.0;
    let (positions, indices) = plate(40, size, false);
    let uv = (positions.as_chunks::<3>().0.iter()).flat_map(|p| [p[0] / size, p[2] / size]);
    let carried = [
        Attribute {
            flag: FLAG_NORMAL,
            width: 3,
            values: vertex_normals(&positions, &indices),
        },
        Attribute {
            flag: FLAG_UV,
            width: 2,
            values: uv.collect(),
        },
    ];
    let (placed, attributes, taken) = lowest(&cover(&positions, &indices, &carried));
    assert!(taken.len() < indices.len());
    for flag in [FLAG_NORMAL, FLAG_UV] {
        let held = attributes
            .iter()
            .find(|a| a.flag == flag)
            .expect("attribute");
        assert_eq!(
            held.values.len(),
            placed.len() / 3 * held.width,
            "flag {flag}"
        );
    }
    let normals = attributes
        .iter()
        .find(|a| a.flag == FLAG_NORMAL)
        .expect("normals");
    for normal in normals.values.as_chunks::<3>().0 {
        assert!((length(*normal) - 1.0).abs() < 1e-3, "{normal:?}");
    }
}

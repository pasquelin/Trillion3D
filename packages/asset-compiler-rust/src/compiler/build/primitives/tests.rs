use super::*;
use crate::compiler::source::assembly::plan::Use;
use trillion3d_math::matrix::IDENTITY;

/// A compiled primitive that handed on nothing but its roots `cover`.
fn handing_on(cover: Option<RootCover>) -> CompiledPrimitive {
    CompiledPrimitive {
        value: Value::Null,
        cluster_planes: Vec::new(),
        collision: Value::Null,
        source_cover: Default::default(),
        voxel_seed: Default::default(),
        page_run: None,
        cover,
        parents: Vec::new(),
    }
}

/// The roots of a part that ends in 128 triangles over 130 vertices.
fn roots() -> RootCover {
    RootCover {
        positions: vec![0.0; 3 * 130],
        carried: Vec::new(),
        indices: vec![0; 3 * 128],
        lod_error: 1.0,
        sphere: [0.0, 0.0, 0.0, 1.0],
    }
}

/// The plan where the carrier (1, 0) takes `count` instances of the part (0, 0).
fn plan(count: usize) -> AssemblyPlan {
    let uses = (0..count).map(|at| Use {
        at,
        part: (0, 0),
        matrix: IDENTITY,
    });
    AssemblyPlan {
        carriers: BTreeMap::from([((1, 0), uses.collect())]),
        parts: BTreeSet::from([(0, 0)]),
    }
}

// Behaviour: a carrier is admitted for its own working set and for the climb over the roots of
// every instance's part, which the compiled parts tell: the admission has seen the climb of two
// thousand instances of a part, not the placeholder's one triangle. The carrier is handed the
// roots of its part.
#[test]
fn a_carrier_is_admitted_for_the_climb_over_every_instance() {
    let (count, jobs, working) = (2_000, [(0, 0), (1, 0)], [100, 100]);
    let (compiled, admitted) = run_jobs(
        &plan(count),
        (&jobs, &working, 1 << 20),
        &BTreeMap::new(),
        |i, covers, _| {
            assert_eq!(
                covers.len(),
                i,
                "the carrier reads the part's roots, the part none"
            );
            Ok(Some(handing_on((i == 0).then(roots))))
        },
    )
    .expect("runs");
    assert_eq!(compiled.len(), 2);
    let climb = climb_working(std::iter::repeat_n((128, 130), count));
    assert!(climb > 1 << 20, "a climb past the room: {climb}");
    assert!(
        admitted.most >= 100 + climb,
        "{admitted:?} for a climb of {climb}"
    );
}

// Behaviour: a part that built no job hands on no roots: it names no instance of the carrier,
// which is admitted for its own working set alone; the results keep the jobs' order, a job that
// builds none a `None`.
#[test]
fn a_part_that_built_no_job_names_no_instance() {
    let (jobs, working) = ([(0, 0), (1, 0)], [100, 100]);
    let (compiled, admitted) = run_jobs(
        &plan(50),
        (&jobs, &working, 1 << 20),
        &BTreeMap::new(),
        |i, covers, _| {
            assert!(covers.is_empty());
            Ok((i == 1).then(|| handing_on(None)))
        },
    )
    .expect("runs");
    assert_eq!(
        compiled.iter().map(Option::is_some).collect::<Vec<_>>(),
        [false, true]
    );
    assert_eq!(admitted.most, 100, "no climb to charge");
}

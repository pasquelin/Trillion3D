use super::*;
use crate::dag::{DagCluster, DagGroup};

fn cluster(
    level: usize,
    indices: usize,
    group: Option<usize>,
    source: Option<usize>,
) -> DagCluster {
    DagCluster {
        indices: vec![0; indices],
        level,
        lod_error: level as f64,
        parent_error: if group.is_some() {
            level as f64 + 1.0
        } else {
            f64::INFINITY
        },
        sphere: [0.0; 4],
        parent_sphere: [0.0; 4],
        replacement: None,
        source_rank: 0,
        group,
        source,
    }
}

fn group(level: usize, children: Vec<usize>, outputs: Vec<usize>) -> DagGroup {
    DagGroup {
        level,
        error: level as f64,
        sphere: [0.0; 4],
        children,
        outputs,
    }
}

#[test]
fn every_bundle_lists_a_closure_that_reaches_the_root_cover_within_the_published_bound() {
    let (root, options) = grid_fixture_displaced(100, 100, 3.0);
    let result = compile(&options, |_| {}).expect("compile");
    let primitive = &result["primitives"][0];
    let pages = primitive["pages"].as_array().expect("pages");
    let streams = &primitive["streams"];
    let pinned = streams["pinned"].as_u64().expect("pinned") as usize;
    let bound = streams["maxDependencies"].as_u64().expect("bound") as usize;
    let lists: Vec<Vec<usize>> = streams["pages"]
        .as_array()
        .expect("bundles")
        .iter()
        .map(|bundle| {
            let list = bundle["dependencies"].as_array().expect("dependencies");
            list.iter()
                .map(|d| d.as_u64().expect("index") as usize)
                .collect()
        })
        .collect();
    assert!(
        lists.len() > pinned,
        "the grid needs bundles past the root cover"
    );
    assert_eq!(
        lists.iter().map(Vec::len).max(),
        Some(bound),
        "the bound is the largest count"
    );
    for (bundle, list) in lists.iter().enumerate() {
        assert!(list.len() <= bound);
        assert_eq!(
            bundle < pinned,
            list.is_empty(),
            "only the root cover depends on nothing"
        );
        if bundle >= pinned {
            assert!(
                list.iter().any(|&d| d < pinned),
                "bundle {bundle} reaches the root cover"
            );
        }
        for &dependency in list {
            assert!(
                lists[dependency].iter().all(|d| list.contains(d)),
                "{bundle} is closed"
            );
        }
    }
    // Every cluster's parents, the outputs of its group, sit in its bundle's list.
    let groups = primitive["structure"]["groups"].as_array().expect("groups");
    for page in pages {
        let Some(group) = page["group"].as_u64() else {
            continue;
        };
        let own = page["stream"].as_u64().expect("stream") as usize;
        for parent in groups[group as usize]["outputs"]
            .as_array()
            .expect("outputs")
        {
            let holder = pages[parent.as_u64().expect("id") as usize]["stream"]
                .as_u64()
                .unwrap();
            assert!(
                lists[own].contains(&(holder as usize)),
                "bundle {own} lists {holder}"
            );
        }
    }
    fs::remove_dir_all(root).expect("cleanup");
}

#[test]
fn a_dependency_cycle_is_refused_with_the_bundle_named() {
    let error = close_dependencies(&[vec![], vec![2], vec![1]]).expect_err("refused");
    assert_eq!(error.code, "INVALID_PAGE_DEPENDENCIES");
    assert!(error.message.contains("bundle 1"), "{error}");
}

#[test]
fn a_page_whose_parent_bundle_is_not_listed_is_refused_with_the_page_named() {
    // Slot 0 is the root, slot 1 its child: bundle 1 must list bundle 0.
    let dag = vec![cluster(1, 3, None, Some(0)), cluster(0, 3, Some(0), None)];
    let groups = vec![group(1, vec![1], vec![0])];
    let error = verify_dependencies(&dag, &groups, &[0, 1], &[0, 1], &[vec![], vec![]], 1)
        .expect_err("refused");
    assert!(
        error.message.contains("Page 1") && error.message.contains("bundle 0"),
        "{error}"
    );
    assert!(verify_dependencies(&dag, &groups, &[0, 1], &[0, 1], &[vec![], vec![0]], 1).is_ok());
}

#[test]
fn siblings_are_packed_together_so_a_bundle_depends_on_one_bundle_per_level() {
    // One root; sixteen 64 KiB clusters under it, two per bundle; sixty-four 16 KiB clusters, four
    // per level-1 parent, eight per bundle. The culling order interleaves the families, so packing
    // by rank alone would spread each fine bundle's parents over eight level-1 clusters.
    let mut dag = vec![cluster(2, 3, None, Some(0))];
    let mut groups = vec![group(2, (1..17).collect(), vec![0])];
    for parent in 0..16 {
        dag.push(cluster(1, 16 * 1024, Some(0), Some(1 + parent)));
        groups.push(group(
            1,
            (0..4).map(|k| 17 + parent * 4 + k).collect(),
            vec![1 + parent],
        ));
    }
    for child in 0..64 {
        dag.push(cluster(0, 4 * 1024, Some(1 + child / 4), None));
    }
    let mut order: Vec<usize> = (0..17).collect();
    order.extend((0..64).map(|rank| 17 + (rank % 16) * 4 + rank / 16));
    let (bundles, pinned, bundle_of) = pack_bundles(&dag, &groups, &order);
    assert_eq!((bundles.len(), pinned), (17, 1));
    let direct = direct_dependencies(&dag, &groups, &bundle_of, bundles.len());
    let closed = close_dependencies(&direct).expect("acyclic");
    verify_dependencies(&dag, &groups, &order, &bundle_of, &closed, pinned).expect("listed");
    for bundle in 9..17 {
        assert_eq!(
            direct[bundle].len(),
            1,
            "fine bundle {bundle} has one parent bundle"
        );
        assert_eq!(closed[bundle].len(), 2, "and the root cover above it");
    }
}

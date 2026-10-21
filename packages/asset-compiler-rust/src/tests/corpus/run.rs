//! The corpus, family by family: every case on two seeds, every invariant, and a panic named
//! after the case that raised it.
use super::*;
use std::panic::{catch_unwind, AssertUnwindSafe};

const SEEDS: [u64; 2] = [1, 7];

/// The seeds the knife-edge cases run on (`attributes::knife_edges`).
const MANY_SEEDS: std::ops::RangeInclusive<u64> = 1..=16;

fn run(family: Vec<(Generator, Expect)>) {
    run_seeds(family, SEEDS)
}

fn run_seeds(family: Vec<(Generator, Expect)>, seeds: impl IntoIterator<Item = u64> + Clone) {
    for (generate, expect) in family {
        for seed in seeds.clone() {
            let case = generate(seed);
            let label = format!("{} (seed {seed})", case.name);
            let outcome = catch_unwind(AssertUnwindSafe(|| {
                let mut roots = Vec::new();
                for indices in case.primitives() {
                    let built = invariants::build(&case, &indices);
                    invariants::check_structure(&case, &indices, &built, &label);
                    invariants::check_roots(&built, &label);
                    invariants::check_pages(&built, &label);
                    roots.push(built.roots());
                }
                cache::check_cache(&case, &expect, &roots, &label);
            }));
            if let Err(panic) = outcome {
                let message = panic
                    .downcast_ref::<String>()
                    .cloned()
                    .or_else(|| panic.downcast_ref::<&str>().map(|s| s.to_string()))
                    .unwrap_or_default();
                panic!("{label}: {message}");
            }
        }
    }
}

#[test]
fn uv_layouts_are_explained() {
    run([uv::cases(), uv_degenerate::cases()].concat());
}

#[test]
fn attributes_are_explained() {
    run(attributes::cases());
}

/// The cases whose last groups have little to spare, on many seeds: each climbs to one root.
#[test]
fn knife_edges_climb_to_one_root_on_every_seed() {
    run_seeds(attributes::knife_edges(), MANY_SEEDS);
}

/// A mesh whose normals face against its winding builds the DAG of the same mesh lit from the
/// front, level for level: the same triangles, the same errors. Judged from the winding alone, a
/// sphere lit from behind reduced 0.78 per level instead of a half (`dag::quality`).
#[test]
fn normals_against_the_winding_build_the_dag_of_normals_with_it() {
    let shape = |built: &invariants::Built| -> Vec<(usize, Vec<u32>, u64)> {
        let each = built.dag.iter();
        each.map(|c| (c.level, c.indices.clone(), c.lod_error.to_bits()))
            .collect()
    };
    for (front, behind) in attributes::turned_around() {
        for seed in SEEDS {
            let (front, behind) = (front(seed), behind(seed));
            assert_eq!(
                shape(&invariants::build(&front, &front.indices)),
                shape(&invariants::build(&behind, &behind.indices)),
                "{} (seed {seed})",
                behind.name
            );
        }
    }
}

/// Foliage — thousands of small parts that share no position, the clusters cutting many of them —
/// on many seeds: each climbs to one root, no group stalled.
#[test]
fn foliage_climbs_to_one_root_on_every_seed() {
    run_seeds(foliage::cases(), MANY_SEEDS);
}

#[test]
fn topologies_are_explained() {
    run(topology::cases());
}

#[test]
fn materials_are_explained() {
    run(materials::cases());
}

#[test]
fn inputs_are_explained() {
    run(inputs::cases());
}

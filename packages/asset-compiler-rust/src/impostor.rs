//! Octahedral impostors, the compiler bake (#817, part 1 of the design written there).
//!
//! Far away, a tree still costs its DAG root: thousands of leaf cards drawn at a few pixels
//! each. For each eligible mesh the compiler captures `FRAMES`×`FRAMES` orthographic views of
//! its level-0 triangles, one per vertex of an octahedral lattice, into one atlas of three
//! maps: base colour and coverage, object normal and depth, packed ORM. The rays run through
//! the compiler's one CPU tracer (`tracer::trace_where`) over the one BVH constructor
//! (`proxy::bvh`), with a hit filter that lets them through a cut texel; the texels come from
//! the chains `texture_preview` reduced, the cut from the material `cutout` settled. Each map's
//! mips follow the texture rule, the colour map's keeping level 0's coverage (#44).
//!
//! Eligibility is derived from the mesh — root triangles, measured coverage, placements —
//! (`eligibility.rs`), and the compile report names every drawn mesh baked or refused, with its
//! reason (`stage.rs`). The runtime card, the switch and the crossfade are #483.
mod atlas;
mod bake;
mod eligibility;
mod mesh;
mod octahedron;
mod stage;
mod surface;
#[cfg(test)]
mod tests;

pub(crate) use stage::stage_stand_ins;

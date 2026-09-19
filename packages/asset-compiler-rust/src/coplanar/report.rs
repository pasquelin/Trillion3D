use super::*;

/// What the stage did, in the words a reader of the cache needs to find the pixels it moved: which
/// objects share which plane, how much ground they share and which layer each one ended on.
pub fn report(
    surfaces: &[Surface],
    overlaps: &[Overlap],
    assigned: &[u32],
    counts: &Counts,
    bounds: &CoplanarBounds,
    offset_quantum: f64,
) -> Value {
    let mut listed = Vec::new();
    let mut overlap_area = 0.0f64;
    let mut overlap_cells = 0usize;
    let mut clusters = 0usize;
    let mut per_layer: BTreeMap<u32, (usize, usize)> = BTreeMap::new();
    for overlap in overlaps {
        overlap_area += overlap.area;
        overlap_cells += overlap.cells;
    }
    for (index, surface) in surfaces.iter().enumerate() {
        if assigned[index] == 0 {
            continue;
        }
        clusters += surface.pages.len();
        let entry = per_layer.entry(assigned[index]).or_insert((0, 0));
        entry.0 += 1;
        entry.1 += surface.pages.len();
        if listed.len() < MAX_LISTED {
            listed.push(json!({"node":surface.node,"mesh":surface.mesh,"primitive":surface.primitive,"material":surface.material,
   "layer":assigned[index],"clusters":surface.pages.len(),"area":surface.area,
   "plane":{"normal":surface.normal,"offset":surface.offset},
   "worldMin":surface.low,"worldMax":surface.high}));
        }
    }
    let pairs = overlap_pairs(surfaces, overlaps, assigned);
    let layers: Vec<Value> = per_layer
        .iter()
        .map(|(layer, (surfaces, clusters))| json!({"layer":layer,"surfaces":surfaces,"clusters":clusters}))
        .collect();
    json!({"stage":COPLANAR_STAGE,"maxLayer":COPLANAR_MAX_LAYER,"offsetQuantum":offset_quantum,
  "bounds":{"maxPlanesPerPrimitive":bounds.max_planes_per_primitive,"maxSurfacesPerPlane":bounds.max_surfaces_per_plane,
   "maxPairs":bounds.max_pairs,"maxTrianglesPerSurface":bounds.max_triangles_per_surface,"grid":bounds.grid,
   "minOverlapCells":bounds.min_overlap_cells,"flatnessRatio":bounds.flatness_ratio},
  "surfaces":surfaces.len(),"planes":counts.planes,"candidatePlanes":counts.candidate_planes,
  "overlaps":overlaps.len(),"overlapArea":overlap_area,"overlapCells":overlap_cells,"layeredSurfaces":listed.len().min(MAX_LISTED),
  "layeredClusters":clusters,"layeredPages":counts.layered_pages,"layers":layers,
  "layerOverflow":counts.layer_overflow,"droppedPlanes":counts.dropped_planes,
  "unreadSurfaces":counts.unread_surfaces,"skippedPairs":counts.skipped_pairs,
  "instanceConflicts":counts.instance_conflicts,"objects":listed,"pairs":pairs})
}

/// The overlaps themselves, each naming the surface underneath, the one on top and the ground they
/// share. This is what a reader compares two images against: every pixel this stage can move lies
/// inside one of these boxes, and nowhere else.
fn overlap_pairs(surfaces: &[Surface], overlaps: &[Overlap], assigned: &[u32]) -> Vec<Value> {
    let name = |index: usize| {
        let surface = &surfaces[index];
        json!({"node":surface.node,"mesh":surface.mesh,"primitive":surface.primitive,
   "material":surface.material,"layer":assigned[index],"area":surface.area})
    };
    let mut listed = Vec::new();
    for overlap in overlaps.iter().take(MAX_LISTED) {
        let (under, over) = if assigned[overlap.a] <= assigned[overlap.b] {
            (overlap.a, overlap.b)
        } else {
            (overlap.b, overlap.a)
        };
        let mut low = [0.0f64; 3];
        let mut high = [0.0f64; 3];
        for axis in 0..3 {
            low[axis] = surfaces[under].low[axis].max(surfaces[over].low[axis]);
            high[axis] = surfaces[under].high[axis].min(surfaces[over].high[axis]);
        }
        listed.push(
            json!({"under":name(under),"over":name(over),"area":overlap.area,
   "cells":overlap.cells,"worldMin":low,"worldMax":high}),
        );
    }
    listed
}
/// Surfaces named one by one in the report. Past this the counters still hold every one of them.
const MAX_LISTED: usize = 256;

/// Everything the stage had to leave out, counted rather than hidden.
#[derive(Default)]
pub struct Counts {
    /// Distinct clusters carrying a layer. A primitive placed multiple times counts
    /// only once: number of manifest rows written by the step.
    pub layered_pages: usize,
    pub planes: usize,
    pub candidate_planes: usize,
    pub layer_overflow: usize,
    pub dropped_planes: usize,
    pub unread_surfaces: usize,
    pub skipped_pairs: usize,
    pub instance_conflicts: usize,
}

use super::*;

/// Pairs of surfaces of one plane that really cover common ground. Boxes first, triangles second.
pub fn find_overlaps(
    inputs: &CoplanarInputs<'_>,
    bounds: &CoplanarBounds,
    surfaces: &[Surface],
    counts: &mut Counts,
    world: &[crate::compiler_world::Mat4],
) -> Result<Vec<Overlap>> {
    let groups = groups::plane_groups(surfaces, inputs.offset_quantum);
    counts.planes = groups.len();
    let mut state = Search {
        overlaps: Vec::new(),
        left: vec![0u64; bounds.grid * bounds.grid / 64],
        right: vec![0u64; bounds.grid * bounds.grid / 64],
        prints: BTreeMap::new(),
    };
    let total = groups.len();
    for (done, members) in groups.into_iter().enumerate() {
        (inputs.cancelled)()?;
        (inputs.progress)(
            json!({"phase":"coplanar","step":"planes","completed":done,"total":total}),
        );
        if members.len() > bounds.max_surfaces_per_plane {
            counts.skipped_pairs += members.len();
            continue;
        }
        if !worth_testing(surfaces, &members) {
            continue;
        }
        counts.candidate_planes += 1;
        let (u, v) = plane::plane_frame(surfaces[members[0]].normal);
        let rectangles: Vec<overlap::Rect> = members
            .iter()
            .map(|index| overlap::rectangle(&surfaces[*index], u, v))
            .collect();
        for a in 0..members.len() {
            for b in (a + 1)..members.len() {
                test_pair(
                    inputs,
                    bounds,
                    surfaces,
                    world,
                    (members[a], members[b]),
                    (&rectangles[a], &rectangles[b]),
                    counts,
                    &mut state,
                )?;
            }
        }
    }
    Ok(state.overlaps)
}

/// A plane where every surface belongs to the same object and the same material has no contest to
/// settle: its clusters already draw in one order and nothing here touches them.
fn worth_testing(surfaces: &[Surface], members: &[usize]) -> bool {
    members.len() > 1
        && members.iter().any(|index| {
            surfaces[*index].node != surfaces[members[0]].node
                || surfaces[*index].material != surfaces[members[0]].material
        })
}

struct Search {
    overlaps: Vec<Overlap>,
    left: Vec<u64>,
    right: Vec<u64>,
    prints: BTreeMap<usize, Option<overlap::Footprint>>,
}

#[allow(clippy::too_many_arguments)]
fn test_pair(
    inputs: &CoplanarInputs<'_>,
    bounds: &CoplanarBounds,
    surfaces: &[Surface],
    world: &[crate::compiler_world::Mat4],
    pair: (usize, usize),
    rectangles: (&overlap::Rect, &overlap::Rect),
    counts: &mut Counts,
    state: &mut Search,
) -> Result<()> {
    let (one, two) = pair;
    if surfaces[one].node == surfaces[two].node && surfaces[one].material == surfaces[two].material
    {
        return Ok(());
    }
    let Some(rect) = overlap::intersection(rectangles.0, rectangles.1) else {
        return Ok(());
    };
    if state.overlaps.len() + counts.skipped_pairs >= bounds.max_pairs {
        counts.skipped_pairs += 1;
        return Ok(());
    }
    for index in [one, two] {
        if let std::collections::btree_map::Entry::Vacant(slot) = state.prints.entry(index) {
            let print = overlap::footprint(
                inputs,
                &world[surfaces[index].node],
                &surfaces[index],
                bounds,
            )?;
            if print.is_none() {
                counts.unread_surfaces += 1;
            }
            slot.insert(print);
        }
    }
    let (Some(first), Some(second)) = (
        state.prints.get(&one).and_then(Option::as_ref),
        state.prints.get(&two).and_then(Option::as_ref),
    ) else {
        return Ok(());
    };
    overlap::cover(first, &rect, bounds.grid, &mut state.left);
    overlap::cover(second, &rect, bounds.grid, &mut state.right);
    let cells = overlap::shared(&state.left, &state.right);
    if cells < bounds.min_overlap_cells {
        return Ok(());
    }
    let cell_area =
        (rect.1[0] - rect.0[0]) * (rect.1[1] - rect.0[1]) / (bounds.grid * bounds.grid) as f64;
    state.overlaps.push(Overlap {
        a: one,
        b: two,
        cells,
        area: cells as f64 * cell_area,
    });
    Ok(())
}

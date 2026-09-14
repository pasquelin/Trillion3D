use super::*;

/// Two surfaces of one plane that cover common ground, and how much of it.
pub struct Overlap {
    pub a: usize,
    pub b: usize,
    pub cells: usize,
    pub area: f64,
}

/// Rank of a surface in its plane, smallest first — smallest is the one underneath.
///
/// Without an explicit priority the thinner surface wins: the overlay a scene paints on a floor is
/// always the smaller of the two, and a tie falls to source order, later on top. `coplanarPriority`
/// on a node or a mesh replaces that rule outright, which is why it sorts first. The last two terms
/// only make the order total, so that no two surfaces can ever ask to be above each other.
fn key(surface: &Surface) -> (i64, std::cmp::Reverse<[u8; 8]>, usize, usize, [i64; 4]) {
    (
        surface.priority,
        std::cmp::Reverse(surface.area.to_bits().to_be_bytes()),
        surface.order,
        surface.primitive,
        surface.key,
    )
}

/// The layer of every surface: 0 for a surface nothing has to draw under, then one step per surface
/// actually below it.
///
/// A layer is not a rank in a pile: it is the longest chain of overlaps that ends on this surface.
/// Two overlays that both sit on one floor but nowhere near each other therefore share layer 1
/// instead of being stacked one above the other — which keeps the four bits for real stacks and
/// keeps every instance of one object on the same layer. A stack deeper than `max_layer` is clamped
/// and counted rather than silently wrapped.
pub fn layers(surfaces: &[Surface], overlaps: &[Overlap], max_layer: u32) -> (Vec<u32>, usize) {
    let mut order: Vec<usize> = (0..surfaces.len()).collect();
    order.sort_by(|a, b| key(&surfaces[*a]).cmp(&key(&surfaces[*b])));
    let mut rank = vec![0usize; surfaces.len()];
    for (position, index) in order.iter().enumerate() {
        rank[*index] = position;
    }
    // Every overlap is one edge from the surface underneath to the one on top; the ranking makes
    // that direction total, so the edges can hold no cycle and one pass in rank order is enough.
    let mut below: Vec<Vec<usize>> = vec![Vec::new(); surfaces.len()];
    for overlap in overlaps {
        let (under, over) = if rank[overlap.a] < rank[overlap.b] {
            (overlap.a, overlap.b)
        } else {
            (overlap.b, overlap.a)
        };
        below[over].push(under);
    }
    let mut assigned = vec![0u32; surfaces.len()];
    let mut overflow = 0usize;
    for index in order {
        let mut layer = 0u32;
        for under in &below[index] {
            layer = layer.max(assigned[*under] + 1);
        }
        if layer > max_layer {
            overflow += 1;
        }
        assigned[index] = layer.min(max_layer);
    }
    (assigned, overflow)
}

//! A closed walk through bowties split into simple loops (`split`): of the bowties it met, those it
//! passes more than once are split at, round after round —
//!
//! - each such bowtie's loop: from its first pass to its next, or else from that next round to the
//!   first, whichever passes no other such bowtie (`simple_loop`);
//! - the shortest of those loops, the first of equals, taken out of the walk as a loop of its own;
//!   its bowtie no longer split at once the walk passes it fewer than twice;
//!
//! — and the vertices left, when any, one last loop. A round with no such loop fails the split.

/// A vertex taken out of the walk once its loop is split off.
const GONE: usize = usize::MAX;

/// The loops of a closed walk of `vertices` that met `bowties` (module doc); `Err` with the
/// vertices still in the walk, in order, when the split fails.
pub(super) fn split(
    mut vertices: Vec<usize>,
    bowties: &[usize],
) -> Result<Vec<Vec<usize>>, Vec<usize>> {
    let passes = |vertices: &[usize], v: usize| vertices.iter().filter(|&&x| x == v).count();
    let mut twice: Vec<usize> = (bowties.iter().copied())
        .filter(|&b| passes(&vertices, b) > 1)
        .collect();
    if twice.is_empty() {
        return Ok(vec![vertices]);
    }
    let mut loops = Vec::new();
    while !twice.is_empty() {
        let mut shortest: Option<(usize, usize, [usize; 2])> = None;
        for &bowtie in &twice {
            if let Some(span) = simple_loop(&vertices, &twice, bowtie) {
                let length = counted(&vertices, span);
                if shortest.is_none_or(|(_, least, _)| length < least) {
                    shortest = Some((bowtie, length, span));
                }
            }
        }
        let Some((bowtie, _, [from, to])) = shortest else {
            return Err(left(vertices));
        };
        let n = vertices.len();
        let mut taken = Vec::new();
        let mut i = from;
        while i != to {
            if vertices[i] != GONE {
                taken.push(std::mem::replace(&mut vertices[i], GONE));
            }
            i = (i + 1) % n;
        }
        loops.push(taken);
        if passes(&vertices, bowtie) < 2 {
            twice.retain(|&b| b != bowtie);
        }
    }
    let rest = left(vertices);
    if !rest.is_empty() {
        loops.push(rest);
    }
    Ok(loops)
}

/// The vertices still in the walk, in order.
fn left(vertices: Vec<usize>) -> Vec<usize> {
    vertices.into_iter().filter(|&v| v != GONE).collect()
}

/// The span from `bowtie`'s first pass to its next, or else from that next round to the first,
/// that passes no other bowtie of `twice`.
fn simple_loop(vertices: &[usize], twice: &[usize], bowtie: usize) -> Option<[usize; 2]> {
    let first = vertices.iter().position(|&v| v == bowtie)?;
    let second = first + 1 + vertices[first + 1..].iter().position(|&v| v == bowtie)?;
    let n = vertices.len();
    let simple = |from: usize, to: usize| {
        let mut i = from;
        while i != to {
            let v = vertices[i];
            if v != GONE && v != bowtie && twice.contains(&v) {
                return false;
            }
            i = (i + 1) % n;
        }
        true
    };
    if simple(first, second) {
        Some([first, second])
    } else if simple(second, first) {
        Some([second, first])
    } else {
        None
    }
}

/// The vertices still in the walk from `from` round to before `to`.
fn counted(vertices: &[usize], [from, to]: [usize; 2]) -> usize {
    let n = vertices.len();
    let mut count = 0;
    let mut i = from;
    while i != to {
        count += usize::from(vertices[i] != GONE);
        i = (i + 1) % n;
    }
    count
}

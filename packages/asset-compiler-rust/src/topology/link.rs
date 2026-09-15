/// Blocs de travail d'une classification : trois listes par sommet et la pile du parcours, prêtées
/// d'un sommet au suivant. Un maillage de plusieurs millions de sommets les allouait autant de fois.
#[derive(Default)]
pub(crate) struct LinkScratch {
    ids: Vec<u32>,
    neighbours: Vec<[u32; 2]>,
    degree: Vec<u8>,
    seen: Vec<bool>,
    stack: Vec<usize>,
}

/// Vertex class from its link: the edges of the faces around it, as (end, opposite) pairs.
///
/// A manifold interior vertex has a closed link, a boundary vertex an open one; anything else is
/// locked. Degrees never exceed two in either case, so the link is walked in place instead of being
/// materialised as a map per vertex.
pub(crate) fn classify_link(links: &[(u32, u32)], scratch: &mut LinkScratch) -> &'static str {
    let LinkScratch {
        ids,
        neighbours,
        degree,
        seen,
        stack,
    } = scratch;
    // Vidés à l'entrée : la fonction sort par une dizaine de chemins, dont plusieurs abandons.
    ids.clear();
    neighbours.clear();
    degree.clear();
    seen.clear();
    stack.clear();
    let slot = |ids: &mut Vec<u32>,
                neighbours: &mut Vec<[u32; 2]>,
                degree: &mut Vec<u8>,
                vertex: u32|
     -> usize {
        match ids.iter().position(|&id| id == vertex) {
            Some(index) => index,
            None => {
                ids.push(vertex);
                neighbours.push([u32::MAX; 2]);
                degree.push(0);
                ids.len() - 1
            }
        }
    };
    for &(a, b) in links {
        if a == b {
            continue;
        }
        for (from, to) in [(a, b), (b, a)] {
            let index = slot(ids, neighbours, degree, from);
            let held = degree[index] as usize;
            if (held >= 1 && neighbours[index][0] == to)
                || (held >= 2 && neighbours[index][1] == to)
            {
                continue;
            }
            if held >= 2 {
                return "locked";
            }
            neighbours[index][held] = to;
            degree[index] = (held + 1) as u8;
        }
    }
    if ids.is_empty() {
        return "locked";
    }
    let mut degree_one = 0;
    let mut degree_two = 0;
    for &held in degree.iter() {
        match held {
            1 => degree_one += 1,
            2 => degree_two += 1,
            _ => return "locked",
        }
    }
    seen.resize(ids.len(), false);
    let mut components = 0;
    for start in 0..ids.len() {
        if seen[start] {
            continue;
        }
        components += 1;
        if components > 1 {
            return "locked";
        }
        stack.push(start);
        while let Some(node) = stack.pop() {
            if seen[node] {
                continue;
            }
            seen[node] = true;
            for &neighbour in neighbours[node].iter().take(degree[node] as usize) {
                if let Some(index) = ids.iter().position(|&id| id == neighbour) {
                    if !seen[index] {
                        stack.push(index);
                    }
                }
            }
        }
    }
    if degree_one == 0 && degree_two == ids.len() {
        "interior"
    } else if degree_one == 2 && degree_two == ids.len() - 2 {
        "boundary"
    } else {
        "locked"
    }
}

#[cfg(test)]
#[path = "link_tests.rs"]
mod tests;

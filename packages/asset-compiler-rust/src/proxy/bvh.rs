use super::{PROXY_LEAF_TRIANGLES, PROXY_NODE_FLOATS, PROXY_NODE_WORDS, PROXY_TRIANGLE_FLOATS};

/// Un nœud en construction : ses bornes, et soit un intervalle de triangles, soit deux enfants.
struct Node {
    low: [f32; 3],
    high: [f32; 3],
    first: usize,
    count: usize,
    escape: usize,
}

/// Bornes d'un intervalle de triangles, lues une fois par nœud.
fn bounds_of(triangles: &[f32], order: &[usize], range: (usize, usize)) -> ([f32; 3], [f32; 3]) {
    let mut low = [f32::INFINITY; 3];
    let mut high = [f32::NEG_INFINITY; 3];
    for slot in &order[range.0..range.1] {
        let base = slot * PROXY_TRIANGLE_FLOATS;
        for vertex in 0..3 {
            for axis in 0..3 {
                let value = triangles[base + vertex * 3 + axis];
                low[axis] = low[axis].min(value);
                high[axis] = high[axis].max(value);
            }
        }
    }
    (low, high)
}

/// Barycentre d'un triangle sur un axe : ce que la médiane trie.
fn centre(triangles: &[f32], slot: usize, axis: usize) -> f32 {
    let base = slot * PROXY_TRIANGLE_FLOATS;
    (triangles[base + axis] + triangles[base + 3 + axis] + triangles[base + 6 + axis]) / 3.0
}

/// Construit l'arbre par médiane sur l'axe le plus long, feuille à `PROXY_LEAF_TRIANGLES`.
///
/// La médiane donne un arbre équilibré, donc une profondeur en logarithme du nombre de triangles :
/// le moteur peut annoncer une borne de traversée connue avant l'image. Une division qui ne sépare
/// rien — tous les barycentres confondus — coupe en deux parts égales plutôt que de boucler.
fn split(triangles: &[f32], order: &mut [usize], range: (usize, usize), nodes: &mut Vec<Node>) {
    let (low, high) = bounds_of(triangles, order, range);
    let at = nodes.len();
    nodes.push(Node {
        low,
        high,
        first: range.0,
        count: range.1 - range.0,
        escape: 0,
    });
    if range.1 - range.0 <= PROXY_LEAF_TRIANGLES {
        nodes[at].escape = at + 1;
        return;
    }
    let axis = (0..3)
        .max_by(|a, b| (high[*a] - low[*a]).total_cmp(&(high[*b] - low[*b])))
        .unwrap_or(0);
    let middle = range.0 + (range.1 - range.0) / 2;
    order[range.0..range.1].select_nth_unstable_by(middle - range.0, |a, b| {
        centre(triangles, *a, axis).total_cmp(&centre(triangles, *b, axis))
    });
    nodes[at].count = 0;
    split(triangles, order, (range.0, middle), nodes);
    split(triangles, order, (middle, range.1), nodes);
    nodes[at].escape = nodes.len();
}

/// Construit le BVH et réordonne les triangles et leurs albédos pour que chaque feuille nomme un
/// intervalle contigu. Rend les deux colonnes de nœuds, aplaties.
pub fn build(triangles: &mut Vec<f32>, albedo: &mut Vec<u32>) -> (Vec<f32>, Vec<u32>) {
    let count = triangles.len() / PROXY_TRIANGLE_FLOATS;
    if count == 0 {
        return (Vec::new(), Vec::new());
    }
    let mut order: Vec<usize> = (0..count).collect();
    let mut nodes: Vec<Node> = Vec::with_capacity(count * 2 / PROXY_LEAF_TRIANGLES + 2);
    split(triangles, &mut order, (0, count), &mut nodes);
    let mut sorted = Vec::with_capacity(triangles.len());
    let mut colours = Vec::with_capacity(albedo.len());
    for slot in &order {
        let base = slot * PROXY_TRIANGLE_FLOATS;
        sorted.extend_from_slice(&triangles[base..base + PROXY_TRIANGLE_FLOATS]);
        colours.push(albedo[*slot]);
    }
    *triangles = sorted;
    *albedo = colours;
    let mut node_bounds = Vec::with_capacity(nodes.len() * PROXY_NODE_FLOATS);
    let mut node_links = Vec::with_capacity(nodes.len() * PROXY_NODE_WORDS);
    for node in &nodes {
        node_bounds.extend_from_slice(&node.low);
        node_bounds.extend_from_slice(&node.high);
        node_links.push(node.escape as u32);
        node_links.push(node.first as u32);
        node_links.push(node.count as u32);
    }
    (node_bounds, node_links)
}

/// L'emprise monde du proxy. Un proxy vide garde une emprise nulle, jamais une emprise infinie.
pub fn extent(triangles: &[f32]) -> [f64; 6] {
    if triangles.is_empty() {
        return [0.0; 6];
    }
    let mut bounds = [
        f64::INFINITY,
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    ];
    for vertex in triangles.as_chunks::<3>().0 {
        for axis in 0..3 {
            let value = vertex[axis] as f64;
            bounds[axis] = bounds[axis].min(value);
            bounds[axis + 3] = bounds[axis + 3].max(value);
        }
    }
    bounds
}

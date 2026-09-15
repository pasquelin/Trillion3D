use super::{PROXY_LEAF_TRIANGLES, PROXY_TRIANGLE_FLOATS};

/// Un nœud binaire en construction : ses bornes, et soit un intervalle de triangles, soit son
/// enfant droit — l'enfant gauche est toujours le nœud suivant.
pub struct Node {
    pub low: [f32; 3],
    pub high: [f32; 3],
    pub first: usize,
    pub count: usize,
    pub right: usize,
}
impl Node {
    pub fn leaf(&self) -> bool {
        self.count > 0
    }
    /// L'aire de la boîte, à un facteur deux près : ce qui décide quel enfant s'ouvre en premier
    /// quand un nœud large cherche à se remplir.
    pub fn area(&self) -> f32 {
        let span = [
            (self.high[0] - self.low[0]).max(0.0),
            (self.high[1] - self.low[1]).max(0.0),
            (self.high[2] - self.low[2]).max(0.0),
        ];
        span[0] * span[1] + span[1] * span[2] + span[2] * span[0]
    }
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
        right: 0,
    });
    if range.1 - range.0 <= PROXY_LEAF_TRIANGLES {
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
    let right = nodes.len();
    split(triangles, order, (middle, range.1), nodes);
    nodes[at].right = right;
}

/// Construit l'arbre binaire et réordonne les triangles et leurs albédos pour que chaque feuille
/// nomme un intervalle contigu. C'est `wide::collapse` qui en tire les nœuds larges du cache.
pub fn build(triangles: &mut Vec<f32>, albedo: &mut Vec<u32>) -> Vec<Node> {
    let count = triangles.len() / PROXY_TRIANGLE_FLOATS;
    if count == 0 {
        return Vec::new();
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
    nodes
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

/// L'arbre binaire aplati en sauts de sous-arbre : six nombres de bornes et trois entiers par
/// nœud — saut, premier triangle, nombre de triangles. C'est la forme que l'oracle trace sur le
/// processeur, où une traversée sans pile vaut mieux qu'un nœud large ; le cache du proxy, lui,
/// porte la forme large de `wide::collapse`.
pub fn flatten(nodes: &[Node]) -> (Vec<f32>, Vec<u32>) {
    let mut escape = vec![0u32; nodes.len()];
    for at in (0..nodes.len()).rev() {
        escape[at] = if nodes[at].leaf() {
            at as u32 + 1
        } else {
            escape[nodes[at].right]
        };
    }
    let mut bounds = Vec::with_capacity(nodes.len() * 6);
    let mut links = Vec::with_capacity(nodes.len() * 3);
    for (at, node) in nodes.iter().enumerate() {
        bounds.extend_from_slice(&node.low);
        bounds.extend_from_slice(&node.high);
        links.push(escape[at]);
        links.push(node.first as u32);
        links.push(node.count as u32);
    }
    (bounds, links)
}

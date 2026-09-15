//! Du BVH binaire au BVH large : quatre enfants par nœud, boîtes quantifiées sur huit bits.
//!
//! Un arbre binaire fait descendre un rayon d'un seul cran par nœud visité : sur le proxy d'une
//! ville, la borne de traversée s'épuise avant la feuille, et le rayon renonce. Un nœud à quatre
//! enfants teste quatre boîtes d'un coup, garde la plus proche pour la suite et empile les autres,
//! si bien que la même borne couvre quatre fois plus d'arbre et que le premier triangle touché
//! ferme presque tout le reste.
//!
//! Les boîtes des enfants sont écrites sur huit bits dans les bornes du parent, arrondies vers
//! l'extérieur : une boîte quantifiée contient toujours ce qu'elle contenait, donc aucun triangle
//! ne disparaît d'un rayon. Un nœud large pèse ainsi dix-huit mots pour quatre enfants, là où
//! quatre nœuds binaires en pesaient trente-six.
use super::bvh::Node;
use super::{PROXY_CHILDREN, PROXY_CHILD_WORDS, PROXY_NODE_FLOATS};

/// Ce qu'un nœud large retient d'un de ses enfants : sa boîte, et où lire la suite.
struct Child {
    low: [f32; 3],
    high: [f32; 3],
    /// Indice du nœud large enfant, ou premier triangle d'une feuille.
    offset: u32,
    /// Triangles d'une feuille ; zéro pour un nœud interne.
    count: u32,
}

/// Les quatre enfants d'un nœud binaire, ouverts jusqu'à en avoir quatre : à chaque tour, l'enfant
/// interne dont la boîte est la plus large laisse la place à ses deux enfants. C'est le choix qui
/// rend l'arbre le plus court là où il y a le plus de surface à trier.
fn gather(nodes: &[Node], at: usize) -> Vec<usize> {
    if nodes[at].leaf() {
        return vec![at];
    }
    let mut kids = Vec::with_capacity(PROXY_CHILDREN);
    kids.extend([at + 1, nodes[at].right]);
    while kids.len() < PROXY_CHILDREN {
        let pick = kids
            .iter()
            .enumerate()
            .filter(|(_, index)| !nodes[**index].leaf())
            .max_by(|a, b| nodes[*a.1].area().total_cmp(&nodes[*b.1].area()))
            .map(|(slot, _)| slot);
        let Some(slot) = pick else { break };
        let parent = kids[slot];
        kids[slot] = parent + 1;
        kids.push(nodes[parent].right);
    }
    kids
}

/// Écrit un nœud large et, récursivement, ceux de ses enfants internes. Rend son indice.
fn emit(nodes: &[Node], at: usize, bounds: &mut Vec<f32>, children: &mut Vec<u32>) -> u32 {
    let slot = bounds.len() / PROXY_NODE_FLOATS;
    bounds.extend_from_slice(&nodes[at].low);
    bounds.extend_from_slice(&nodes[at].high);
    let base = children.len();
    children.resize(base + PROXY_CHILDREN * PROXY_CHILD_WORDS, 0);
    let (low, high) = (nodes[at].low, nodes[at].high);
    // Un enfant interne écrit son propre nœud plus loin dans `children` ; les mots de cet
    // emplacement-ci sont déjà réservés, donc chaque enfant se pose dès qu'il connaît son lien.
    for (index, kid) in gather(nodes, at).into_iter().enumerate() {
        let node = &nodes[kid];
        let (offset, count) = if node.leaf() {
            (node.first as u32, node.count as u32)
        } else {
            (emit(nodes, kid, bounds, children), 0)
        };
        let child = Child {
            low: node.low,
            high: node.high,
            offset,
            count,
        };
        let word = base + index * PROXY_CHILD_WORDS;
        children[word..word + PROXY_CHILD_WORDS].copy_from_slice(&pack(&child, low, high));
    }
    slot as u32
}

/// La boîte d'un enfant sur huit bits par axe, arrondie vers l'extérieur, plus ses deux liens.
/// Le mot du haut porte le nombre de triangles et le bit de présence : un emplacement vide n'est
/// jamais testé, et une boîte inversée ne suffirait pas à l'écarter — le test des plans n'y voit
/// que des minimums et des maximums.
fn pack(child: &Child, low: [f32; 3], high: [f32; 3]) -> [u32; PROXY_CHILD_WORDS] {
    let mut quantised = [[0u32; 3]; 2];
    for axis in 0..3 {
        let span = (high[axis] - low[axis]) as f64;
        // Un axe plat, ou non comparable : l'enfant prend toute la largeur du parent sur cet axe,
        // ce qui reste conservateur — une boîte plus large ne perd aucun triangle.
        if !span.is_finite() || span <= 0.0 {
            quantised[1][axis] = 255;
            continue;
        }
        let unit = |value: f32| ((value - low[axis]) as f64 / span * 255.0).clamp(0.0, 255.0);
        quantised[0][axis] = unit(child.low[axis]).floor() as u32;
        quantised[1][axis] = unit(child.high[axis]).ceil() as u32;
    }
    [
        quantised[0][0] | quantised[0][1] << 8 | quantised[0][2] << 16 | quantised[1][0] << 24,
        quantised[1][1] | quantised[1][2] << 8 | child.count << 16 | 1 << 24,
        child.offset,
    ]
}

/// Les deux colonnes de nœuds du cache : les bornes exactes d'un nœud, puis ses quatre enfants.
pub fn collapse(nodes: &[Node]) -> (Vec<f32>, Vec<u32>) {
    if nodes.is_empty() {
        return (Vec::new(), Vec::new());
    }
    let mut bounds = Vec::new();
    let mut children = Vec::new();
    emit(nodes, 0, &mut bounds, &mut children);
    (bounds, children)
}

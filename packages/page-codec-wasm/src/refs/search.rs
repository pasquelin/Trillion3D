//! The search for the vertices a page names, among the clusters it depends on and its own.

use super::*;

/// The clusters of one streaming page, by the vertices they hold: what a page that depends on it
/// searches. Each cluster is its page on disk as the encoder wrote it, storing every vertex but
/// those it lays twice, and its place in the streaming page.
pub struct Shelf<'a> {
    clusters: Vec<(u32, &'a [u8])>,
    /// Each vertex's hash to the last cluster and vertex that holds it.
    index: WordMap<u64, (u32, u8)>,
}

impl<'a> Shelf<'a> {
    /// The shelf of `clusters`, each a place and a page, in the order of the streaming page.
    pub fn of(clusters: Vec<(u32, &'a [u8])>) -> Result<Self, PageError> {
        let mut index = word_map(clusters.len() * 64);
        for (i, &(_, bytes)) in clusters.iter().enumerate() {
            let page = disk::read(bytes, usize::MAX, &[])?;
            for (v, vertex) in vertices_of(&page).iter().enumerate() {
                index.insert(vertex.hash(), (i as u32, v as u8));
            }
        }
        Ok(Self { clusters, index })
    }

    /// The vertices of cluster `cluster`, read again.
    fn vertices(&self, cluster: u32) -> Vec<Vertex> {
        let (_, bytes) = self.clusters[cluster as usize];
        disk::read(bytes, usize::MAX, &[]).map_or_else(|_| Vec::new(), |page| vertices_of(&page))
    }
}

/// A streaming page a page depends on, and its rank in the page's list of dependencies, from 1.
pub struct Parent<'s, 'a> {
    pub rank: u32,
    pub shelf: &'s Shelf<'a>,
}

/// The vertices the clusters of a streaming page store, as its clusters are written in order: each
/// is searched by the clusters after it. It belongs to one streaming page, whose clusters all
/// search the same `parents`: it also keeps the vertices of the parents' clusters that a search
/// hit, read once for the whole streaming page, not again for each cluster that names them.
#[derive(Default)]
pub struct Same {
    index: WordMap<u64, (u32, u8)>,
    vertices: WordMap<u32, Vec<Vertex>>,
    /// The vertices of a parent's cluster, by the parent's rank and the cluster.
    read: WordMap<u64, Vec<Vertex>>,
}

impl Same {
    /// The cluster at `place`, whose vertices are `vertices`, stored but where `named` says: its
    /// stored vertices join the search.
    fn add(&mut self, place: u32, keys: &[u64], vertices: Vec<Vertex>, named: &[bool]) {
        for (v, (&key, &is)) in keys.iter().zip(named).enumerate() {
            if !is {
                self.index.insert(key, (place, v as u8));
            }
        }
        self.vertices.insert(place, vertices);
    }
}

/// What a page names and how, and its vertices: the search of the module's doc over `p`.
pub(super) struct Chosen {
    refs: Refs,
    keys: Vec<u64>,
    vertices: Vec<Vertex>,
}

/// For each vertex of `p` the cluster that holds it, searched through `parents`, then `same`, then
/// the page's own earlier vertices.
pub(super) fn choose(p: &Page, parents: &[Parent], same: &mut Same) -> Chosen {
    let Same {
        index: stored,
        vertices: stored_vertices,
        read,
    } = same;
    let vertices = vertices_of(p);
    let keys: Vec<u64> = vertices.iter().map(Vertex::hash).collect();
    let mut named = vec![false; vertices.len()];
    let mut found: Vec<(u32, u8)> = Vec::new();
    let mut own: WordMap<u64, u8> = word_map(vertices.len());
    for (v, (vertex, &key)) in vertices.iter().zip(&keys).enumerate() {
        let from_parents = parents.iter().find_map(|parent| {
            let &(cluster, index) = parent.shelf.index.get(&key)?;
            let held = read
                .entry(u64::from(parent.rank) << 32 | u64::from(cluster))
                .or_insert_with(|| parent.shelf.vertices(cluster));
            let place = parent.shelf.clusters[cluster as usize].0;
            (held.get(usize::from(index)) == Some(vertex))
                .then_some((pair(parent.rank, place), index))
        });
        let hit = from_parents
            .or_else(|| {
                let &(place, index) = stored.get(&key)?;
                let held = stored_vertices.get(&place)?;
                (held.get(usize::from(index)) == Some(vertex)).then_some((pair(0, place), index))
            })
            .or_else(|| {
                let &index = own.get(&key)?;
                (vertices[usize::from(index)] == *vertex).then_some((SELF_PLACE, index))
            });
        match hit {
            Some(hit) => {
                named[v] = true;
                found.push(hit);
            }
            None => {
                own.insert(key, v as u8);
            }
        }
    }
    let mut pairs: Vec<u32> = found.iter().map(|&(pair, _)| pair).collect();
    pairs.sort_unstable();
    pairs.dedup();
    let entries = found
        .iter()
        .map(|&(pair, index)| {
            let rank = pairs.binary_search(&pair).unwrap_or(0);
            (rank as u8, index)
        })
        .collect();
    Chosen {
        refs: Refs {
            named,
            pairs,
            entries,
        },
        keys,
        vertices,
    }
}

/// The page `p` on disk, naming only its own vertices: those a strip laid twice, or two source
/// vertices that quantize alike.
pub fn alone(p: &Page) -> Vec<u8> {
    disk::write(p, &choose(p, &[], &mut Same::default()).refs)
}

/// The page `page` (a cluster alone: `alone`) at `place` of its streaming page, rewritten naming
/// the vertices the clusters of `parents` and of `same` hold, and `same` taking the vertices it
/// stores. The clusters are shared in the order they lie in the streaming page.
pub fn share(
    page: &[u8],
    place: u32,
    parents: &[Parent],
    same: &mut Same,
) -> Result<Vec<u8>, PageError> {
    let p = disk::read(page, usize::MAX, &[])?;
    let Chosen {
        refs,
        keys,
        vertices,
    } = choose(&p, parents, same);
    let bytes = disk::write(&p, &refs);
    same.add(place, &keys, vertices, &refs.named);
    Ok(bytes)
}

//! A direction's clusters: groups of its surfels that one card covers, found as the reference finds
//! them — first the cluster of the surfels seen from outside, then, for a mesh not mostly
//! two-sided, again and again the cluster of the most coverage behind some cell along the rays —,
//! and the clusters of every direction cut down to the most the mesh keeps, the least covering
//! first.
use super::surfels::Surfel;

/// What decides whether a cluster is worth a card.
pub(super) struct Params {
    /// The weighted coverage a cluster behind the outer one must reach.
    pub min_cluster: f32,
    /// The weighted coverage the outer cluster must reach: that of any other, or half the mean
    /// area of a face of the volume where that is less.
    pub min_outer: f32,
    /// The density a cluster must exceed: its coverage over the area of its box's face.
    pub min_density: f32,
}

/// A group of surfels a card covers.
pub(super) struct Cluster {
    /// The cells holding the cluster's surfels: the lowest and the highest along each axis.
    pub low: [i32; 3],
    pub high: [i32; 3],
    /// The surfels, by rank in their direction's: kept only for a cluster that is committed
    /// (`gather`'s `keep`); the candidates of a round count theirs.
    members: Vec<usize>,
    /// How many surfels the cluster holds.
    count: usize,
    /// The cell along the rays the card begins at: the cluster holds the surfels from there on that
    /// are visible from there.
    near_plane: i32,
    coverage: f32,
    weighted: f32,
}

impl Cluster {
    fn new(near_plane: i32) -> Self {
        Self {
            low: [i32::MAX; 3],
            high: [-i32::MAX; 3],
            members: Vec::new(),
            count: 0,
            near_plane,
            coverage: 0.0,
            weighted: 0.0,
        }
    }

    /// Adds surfel `index` if it lies from the near plane on and is visible from it, naming it among
    /// the members when `keep`.
    fn add(&mut self, index: usize, surfel: &Surfel, keep: bool) {
        if surfel.coord[2] >= self.near_plane && surfel.min_ray_z <= self.near_plane {
            if keep {
                self.members.push(index);
            }
            self.count += 1;
            for k in 0..3 {
                self.low[k] = self.low[k].min(surfel.coord[k]);
                self.high[k] = self.high[k].max(surfel.coord[k]);
            }
            self.coverage += surfel.coverage;
            self.weighted += surfel.weighted;
        }
    }

    /// The area of the face of the box, in cells: its extent along the card's two axes.
    fn face_area(&self) -> i32 {
        (self.high[0] + 1 - self.low[0]) * (self.high[1] + 1 - self.low[1])
    }

    /// Whether the cluster is worth a card: it holds some surfel, covers enough, and densely enough.
    /// A cluster with no surfel covers nothing.
    fn is_valid(&self, params: &Params) -> bool {
        let least = match self.near_plane {
            0 => params.min_outer,
            _ => params.min_cluster,
        };
        self.count > 0
            && self.weighted >= least
            && self.coverage / self.face_area() as f32 > params.min_density
    }
}

/// The cluster from `near_plane` on of the surfels not yet in a cluster, its members listed when
/// `keep` — a cluster only compared with others needs none: the round's best is gathered again
/// with them.
fn gather(near_plane: i32, surfels: &[Surfel], assigned: &[bool], keep: bool) -> Cluster {
    let mut cluster = Cluster::new(near_plane);
    for (index, surfel) in surfels.iter().enumerate() {
        if !assigned[index] {
            cluster.add(index, surfel, keep);
        }
    }
    cluster
}

/// Keeps `cluster`, its surfels taken.
fn commit(clusters: &mut Vec<Cluster>, assigned: &mut [bool], cluster: Cluster) {
    for &index in &cluster.members {
        assigned[index] = true;
    }
    clusters.push(cluster);
}

/// The clusters of one direction's `surfels`, in the order they were found. The cluster of what
/// the card sees from outside comes first; unless the mesh is mostly two-sided — foliage, which a
/// box projection covers better —, each of the next is the most covering one of those from any
/// cell along the rays on (of `depth` cells) that is valid, until none is.
pub(super) fn of_direction(
    surfels: &[Surfel],
    (depth, mostly_two_sided): (i32, bool),
    params: &Params,
) -> Vec<Cluster> {
    let mut assigned = vec![false; surfels.len()];
    let mut clusters = Vec::new();
    let outer = gather(0, surfels, &assigned, true);
    if outer.is_valid(params) {
        commit(&mut clusters, &mut assigned, outer);
    }
    if mostly_two_sided {
        return clusters;
    }
    loop {
        let mut best: Option<Cluster> = None;
        for near_plane in 1..depth {
            let cluster = gather(near_plane, surfels, &assigned, false);
            let beats = best.as_ref().is_none_or(|b| cluster.weighted > b.weighted);
            if cluster.is_valid(params) && beats {
                best = Some(cluster);
            }
        }
        match best {
            Some(cluster) => {
                let cluster = gather(cluster.near_plane, surfels, &assigned, true);
                commit(&mut clusters, &mut assigned, cluster);
            }
            None => return clusters,
        }
    }
}

/// The order clusters are kept in: the most weighted coverage first, then by the centre of the box.
fn order(a: &Cluster, b: &Cluster) -> std::cmp::Ordering {
    let centre = |c: &Cluster, k: usize| c.low[k] + c.high[k];
    (b.weighted.total_cmp(&a.weighted))
        .then(centre(a, 0).cmp(&centre(b, 0)))
        .then(centre(a, 1).cmp(&centre(b, 1)))
        .then(centre(a, 2).cmp(&centre(b, 2)))
}

/// Cuts the clusters of the directions down to `most` in all: each direction's sorted by `order`,
/// then the least weighted of the directions' last, the lowest direction first among equals,
/// dropped one after the other.
pub(super) fn limit(directions: &mut [Vec<Cluster>], most: usize) {
    for clusters in directions.iter_mut() {
        clusters.sort_by(order);
    }
    let mut count: usize = directions.iter().map(Vec::len).sum();
    while count > most {
        let mut least = (f32::MAX, 0);
        for (direction, clusters) in directions.iter().enumerate() {
            if let Some(last) = clusters.last() {
                if last.weighted < least.0 {
                    least = (last.weighted, direction);
                }
            }
        }
        directions[least.1].pop();
        count -= 1;
    }
}

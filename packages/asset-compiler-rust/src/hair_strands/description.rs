//! What a scene file says of a groom, before anything is built: the arrays a driver reads from the
//! curves of one object of the file, in the space of that object and with the widths in metres, and
//! the merge of the objects of a scene into one groom.

use super::scope::{given, ranked, Given, Scope};
use crate::compiler::source::node_transform::Mat4;
use crate::proxy::placement::place;

mod widths;

pub(crate) use widths::{finite_width, Widths, DEFAULT_WIDTH};

/// The curves of one object, or of a whole scene: all the strands of a groom, whatever their group.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct Description {
    /// The position of every point, three numbers each, the strands' points one strand after the
    /// other.
    pub(crate) positions: Vec<f32>,
    /// The point count of each strand, in order.
    pub(crate) counts: Vec<u32>,
    pub(crate) widths: Widths,
    /// The coordinates of each strand's root on the surface it grows from, two numbers each; empty when
    /// the file gives none.
    pub(crate) root_uvs: Vec<f32>,
    /// The colour of every point, three numbers each; empty when the file gives none.
    pub(crate) colors: Vec<f32>,
    /// The roughness of every point; empty when the file gives none.
    pub(crate) roughness: Vec<f32>,
    /// The group number of each strand; empty when the file gives none.
    pub(crate) group_ids: Vec<i32>,
    /// The distinct group names of the strands, and the name of each strand as a rank in them; empty
    /// when the file gives none. The names group the strands where no group number does.
    pub(crate) names: Vec<String>,
    pub(crate) group_names: Vec<u32>,
    /// The width the whole groom declares for the strands that have none of their own, in metres; none
    /// when the file declares none, `DEFAULT_WIDTH` then standing for it.
    pub(crate) groom_width: Option<f32>,
}

/// Extends `into`, which holds `before` entries' worth of values or none, by the `added` entries' worth
/// `from` holds: an attribute that only one side gives is the zero of its type for the other side's
/// entries.
fn join<T: Copy + Default>(into: &mut Vec<T>, before: usize, from: &[T], added: usize) {
    if from.is_empty() {
        if !into.is_empty() {
            into.resize(before + added, T::default());
        }
        return;
    }
    if into.is_empty() {
        into.resize(before, T::default());
    }
    into.extend_from_slice(from);
}

impl Description {
    /// The points the position table holds.
    pub(crate) fn points(&self) -> usize {
        self.positions.len() / 3
    }

    /// The curves of a file's object: `positions` three numbers each point, `declared` the point count
    /// of each curve as the file writes it. The curves are read to the end of what the points cover: a
    /// count that is no count, or that would pass the points, ends the object's curves and the rest are
    /// left out — the second member says so. The first is `None` when no point is left: the object
    /// brings no strand. The arrays the file adds are set by the driver (`set_*`).
    pub(crate) fn from_declared(
        mut positions: Vec<f32>,
        declared: impl IntoIterator<Item = i64>,
    ) -> (Option<Self>, bool) {
        let available = positions.len() / 3;
        let mut counts = Vec::new();
        let mut points = 0usize;
        let mut truncated = false;
        for count in declared {
            let ends = u32::try_from(count)
                .ok()
                .and_then(|count| Some((count, points.checked_add(count as usize)?)))
                .filter(|(_, ends)| *ends <= available);
            let Some((count, ends)) = ends else {
                truncated = true;
                break;
            };
            counts.push(count);
            points = ends;
        }
        if points == 0 {
            return (None, truncated);
        }
        positions.truncate(points * 3);
        let description = Self {
            positions,
            counts,
            ..Self::default()
        };
        (Some(description), truncated)
    }

    /// Makes room for `strands` more strands and `points` more points.
    pub(crate) fn reserve(&mut self, strands: usize, points: usize) {
        self.counts.reserve(strands);
        self.positions.reserve(points * 3);
    }

    /// The strands and the points the groom counts so far, as the scopes of the attributes count them.
    pub(crate) fn shape(&self) -> (usize, usize) {
        (self.counts.len(), self.points())
    }

    /// Sets the widths the file gives by the scope it names (`Widths::from_scope`).
    pub(crate) fn set_widths(&mut self, scope: Scope, values: &[f32], scale: f32) {
        self.widths = Widths::from_scope(scope, values, self.shape(), scale);
    }

    /// The values `values`, `width` numbers each, that are given for the strands; none if they are
    /// given for the points or not at all (`given`).
    fn strand_values<T: Clone>(&self, scope: Scope, values: Vec<T>, width: usize) -> Vec<T> {
        given(scope, values, width, self.shape()).map_or_else(Vec::new, Given::strands)
    }

    /// Sets the root coordinates, two numbers for each strand.
    pub(crate) fn set_root_uvs(&mut self, scope: Scope, values: Vec<f32>) {
        self.root_uvs = self.strand_values(scope, values, 2);
    }

    /// Sets the group number of each strand.
    pub(crate) fn set_group_ids(&mut self, scope: Scope, values: Vec<i32>) {
        self.group_ids = self.strand_values(scope, values, 1);
    }

    /// Sets the colour of each point, three numbers each.
    pub(crate) fn set_colors(&mut self, scope: Scope, values: Vec<f32>) {
        self.colors = given(scope, values, 3, self.shape()).map_or_else(Vec::new, Given::points);
    }

    /// Sets the roughness of each point.
    pub(crate) fn set_roughness(&mut self, scope: Scope, values: Vec<f32>) {
        self.roughness = given(scope, values, 1, self.shape()).map_or_else(Vec::new, Given::points);
    }

    /// Sets the group name of each strand from `names`, which the scope spreads over the strands: the
    /// table of distinct names is made once, each strand holding the rank of its name in it.
    pub(crate) fn set_group_names(&mut self, scope: Scope, names: &[String]) {
        let (table, ranks) = ranked(names.iter().map(String::as_str));
        let ranks = self.strand_values(scope, ranks, 1);
        if !ranks.is_empty() {
            (self.names, self.group_names) = (table, ranks);
        }
    }

    /// Sets the group name of each strand from an indexed table: `indices` holds one for each strand,
    /// a rank in `table`, and the empty name where it names none. Nothing is set when it holds more
    /// or fewer.
    pub(crate) fn set_indexed_group_names(&mut self, table: &[String], indices: &[u32]) {
        if indices.len() != self.counts.len() {
            return;
        }
        let each = indices
            .iter()
            .map(|&index| table.get(index as usize).map_or("", String::as_str));
        (self.names, self.group_names) = ranked(each);
    }

    /// Whether the arrays fit one another: whole positions, strands that pour into the points, and each
    /// attribute as long as the strands or the points it is given for. Checked once, where a groom
    /// enters the compiler (`carrier::take`).
    pub(crate) fn fits(&self) -> bool {
        let points = self.points();
        let strands = self.counts.len();
        let poured: u64 = self.counts.iter().map(|&count| u64::from(count)).sum();
        let attribute = |held: usize, each: usize, over: usize| held == 0 || held == each * over;
        self.positions.len() % 3 == 0
            && poured <= points as u64
            && attribute(self.root_uvs.len(), 2, strands)
            && attribute(self.colors.len(), 3, points)
            && attribute(self.roughness.len(), 1, points)
            && attribute(self.group_ids.len(), 1, strands)
            && attribute(self.group_names.len(), 1, strands)
            && self
                .group_names
                .iter()
                .all(|&name| (name as usize) < self.names.len())
            && match &self.widths {
                Widths::None => true,
                Widths::Strand(widths) => widths.len() == strands,
                Widths::Vertex(widths) => widths.len() == points,
            }
    }

    /// The rank of `name` among the names, added if it is new.
    fn name_rank(&mut self, name: &str) -> u32 {
        let rank = self.names.iter().position(|known| known == name);
        rank.unwrap_or_else(|| {
            self.names.push(name.to_string());
            self.names.len() - 1
        }) as u32
    }

    /// Adds the strands of `other`, its points placed by `matrix` (none for the identity), after
    /// those held. Every attribute is that of one groom: what only one object gives is the zero of its
    /// type for the strands and points of the others, a width as much as a colour; where the objects
    /// give widths of both kinds, those of each point are the groom's and a strand's alone count for
    /// nothing. The groom's width is the last that an object declares.
    pub(crate) fn append(&mut self, other: &Self, matrix: Option<&Mat4>) {
        let (strands, points) = (self.counts.len(), self.points());
        let (added_strands, added_points) = (other.counts.len(), other.points());
        match matrix {
            Some(matrix) => place(&other.positions, matrix, &mut self.positions),
            None => self.positions.extend_from_slice(&other.positions),
        }
        self.counts.extend_from_slice(&other.counts);
        let widths = match (std::mem::take(&mut self.widths), &other.widths) {
            (Widths::None, Widths::None) => Widths::None,
            (Widths::Vertex(mut held), Widths::Vertex(added)) => {
                held.extend_from_slice(added);
                Widths::Vertex(held)
            }
            (Widths::Vertex(mut held), _) => {
                held.resize(points + added_points, 0.0);
                Widths::Vertex(held)
            }
            (_, Widths::Vertex(added)) => {
                let mut held = vec![0.0; points];
                held.extend_from_slice(added);
                Widths::Vertex(held)
            }
            (held, added) => {
                let mut each = match held {
                    Widths::Strand(widths) => widths,
                    _ => vec![0.0; strands],
                };
                match added {
                    Widths::Strand(widths) => each.extend_from_slice(widths),
                    _ => each.resize(strands + added_strands, 0.0),
                }
                Widths::Strand(each)
            }
        };
        self.widths = widths;
        join(
            &mut self.root_uvs,
            strands * 2,
            &other.root_uvs,
            added_strands * 2,
        );
        join(
            &mut self.colors,
            points * 3,
            &other.colors,
            added_points * 3,
        );
        join(&mut self.roughness, points, &other.roughness, added_points);
        join(
            &mut self.group_ids,
            strands,
            &other.group_ids,
            added_strands,
        );
        if !other.group_names.is_empty() || !self.group_names.is_empty() {
            let unset = self.name_rank("");
            self.group_names.resize(strands, unset);
            if other.group_names.is_empty() {
                self.group_names.resize(strands + added_strands, unset);
            }
            let ranks: Vec<u32> = other
                .names
                .iter()
                .map(|name| self.name_rank(name))
                .collect();
            self.group_names
                .extend(other.group_names.iter().map(|&name| ranks[name as usize]));
        }
        if other.groom_width.is_some() {
            self.groom_width = other.groom_width;
        }
    }
}

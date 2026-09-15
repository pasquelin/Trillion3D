//! Ce que chaque commande du sous-ensemble change dans le document.
//!
//! Une commande ne lit rien du format en dehors de ce qui est écrit sur sa ligne : elle pose un
//! nœud, verse une tranche d'attribut, note une liaison, fixe une unité, ou accroche une forme sous
//! un second transform. Rien n'y est évalué, et ce qu'une commande demande sans qu'on sache le faire
//! est compté par son nom au lieu d'être approché.
use super::*;

impl Document {
    /// `createNode <type> -n <nom> -p <père>` : un nœud de plus, qui devient le nœud courant.
    pub(super) fn create(&mut self, command: &Command) {
        let kind = command.operand(0).unwrap_or_default().to_string();
        let name = command
            .text(&["n", "name"])
            .map_or_else(|| format!("{kind}{}", self.nodes.len()), str::to_string);
        let parent = command
            .text(&["p", "parent"])
            .and_then(|parent| self.by_name.get(leaf(parent)).copied());
        self.nodes.push(Node {
            kind,
            name: name.clone(),
            parent,
            attrs: HashMap::new(),
        });
        let id = self.nodes.len() - 1;
        self.by_name.insert(name, id);
        self.current = Some(id);
    }

    /// `setAttr` : une tranche d'un attribut d'un nœud. Sans nom de nœud, celui du moment.
    pub(super) fn set(&mut self, command: &Command) {
        let Some(mut path) = command.operand(0).and_then(attr::path) else {
            self.report.add(report::ATTRIBUTE_INVALID);
            return;
        };
        let target = match &path.node {
            Some(name) => self.by_name.get(leaf(name)).copied(),
            None => self.current,
        };
        let Some(target) = target else {
            self.report.add(report::ATTRIBUTE_UNATTACHED);
            return;
        };
        if path.count.is_none() {
            path.count = command
                .text(&["s", "size"])
                .and_then(|size| size.parse::<usize>().ok());
        }
        let mut refused = Vec::new();
        let written = attr::value(command, &mut refused)
            .and_then(|(value, stride)| attr::slice(&path, value, stride))
            .is_some_and(|(at, value)| self.write(target, &path.key, at, value));
        for reason in refused {
            self.report.add(reason);
        }
        if !written {
            self.count(report::ATTRIBUTE_INVALID, &path.key);
        }
    }

    /// Verse une tranche dans l'attribut d'un nœud, en le créant à sa première écriture.
    fn write(&mut self, target: usize, key: &str, at: usize, value: Attr) -> bool {
        let attrs = &mut self.nodes[target].attrs;
        let mut slot = attrs.remove(key).unwrap_or_else(|| value.empty_like());
        let written = slot.splice(at, value);
        attrs.insert(key.to_string(), slot);
        written
    }

    /// `connectAttr "source.attribut" "cible.attribut"` : une liaison notée, résolue plus tard.
    pub(super) fn connect(&mut self, command: &Command) {
        let mut ends = (0..2)
            .filter_map(|rank| command.operand(rank))
            .filter_map(|written| written.split_once('.'));
        match (ends.next(), ends.next()) {
            (Some((source, source_attr)), Some((target, target_attr))) => self.links.push(Link {
                source: leaf(source).to_string(),
                source_attr: source_attr.to_string(),
                target: leaf(target).to_string(),
                target_attr: target_attr.to_string(),
            }),
            _ => self.report.add(report::ATTRIBUTE_INVALID),
        }
    }

    /// `currentUnit -l <unité> -a <unité>` : l'unité de la scène, dont la racine portera le facteur.
    pub(super) fn unit(&mut self, command: &Command) {
        if let Some(linear) = command.text(&["l", "linear"]).and_then(meters) {
            self.meters_per_unit = linear;
        }
        if let Some(angle) = command.text(&["a", "angle"]) {
            self.degrees_per_unit = match angle {
                "rad" | "radian" => 180.0 / std::f64::consts::PI,
                _ => 1.0,
            };
        }
    }

    /// `parent -add` de formes maillées sous un autre transform : des instances. Toute autre forme
    /// de la commande est comptée — rejouer un déplacement de branche changerait la scène.
    pub(super) fn reparent(&mut self, command: &Command) {
        let named: Vec<usize> = command
            .operands
            .iter()
            .filter_map(|token| self.by_name.get(leaf(token.text())).copied())
            .collect();
        let usable = named.split_last().filter(|(host, shapes)| {
            named.len() == command.operands.len()
                && command.switch(&["add", "a"])
                && !command.switch(&["rm", "removeObject"])
                && report::is_transform(&self.nodes[**host].kind)
                && shapes
                    .iter()
                    .all(|shape| report::is_mesh(&self.nodes[*shape].kind))
        });
        let Some((host, shapes)) = usable else {
            self.report.add(report::PARENT_UNSUPPORTED);
            return;
        };
        let added: Vec<(usize, usize)> = shapes.iter().map(|shape| (*host, *shape)).collect();
        self.instances.extend(added);
    }

    /// Le nœud que `select` désigne, quand ce fichier le porte. Les nœuds par défaut de Maya —
    /// `:time1`, `:renderPartition` — ne sont pas créés par le fichier : ils ne sont pas trouvés,
    /// et les `setAttr` qui les suivent sont comptés plutôt que versés sur un nœud au hasard.
    pub(super) fn selected(&self, command: &Command) -> Option<usize> {
        command
            .operands
            .last()
            .and_then(|token| self.by_name.get(leaf(token.text())))
            .copied()
    }
}

/// Le facteur d'une unité linéaire de Maya vers le mètre, nom court ou nom long.
fn meters(unit: &str) -> Option<f64> {
    Some(match unit {
        "mm" | "millimeter" => 0.001,
        "cm" | "centimeter" => 0.01,
        "m" | "meter" => 1.0,
        "km" | "kilometer" => 1000.0,
        "in" | "inch" => 0.0254,
        "ft" | "foot" => 0.3048,
        "yd" | "yard" => 0.9144,
        "mi" | "mile" => 1609.344,
        _ => return None,
    })
}

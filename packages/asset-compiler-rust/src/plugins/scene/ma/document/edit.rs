//! What each subset command changes in the document.
//!
//! A command reads nothing of the format outside what is written on its line: it places a node,
//! pours an attribute slice, notes a connection, sets a unit, or hangs a shape under a second
//! transform. Nothing is evaluated there, and what a command asks without knowing how to do it
//! is counted by name instead of being approximated.
use super::*;

impl Document {
    /// `createNode <type> -n <name> -p <parent>`: one more node, which becomes the current node.
    pub(super) fn create(&mut self, command: &Command) {
        let kind = command.operand(0).unwrap_or_default().to_string();
        let name = command
            .text(&["n", "name"])
            .map_or_else(|| format!("{kind}{}", self.nodes.len()), str::to_string);
        let parent = command
            .text(&["p", "parent"])
            .and_then(|parent| self.find(parent));
        let full = path::under(self, parent, &name);
        self.nodes.push(Node {
            kind,
            name: name.clone(),
            path: full,
            parent,
            attrs: HashMap::new(),
        });
        let id = self.nodes.len() - 1;
        self.remember(&name, id);
        self.current = Some(id);
    }

    /// `setAttr`: a slice of a node's attribute. Without a node name, the current one.
    pub(super) fn set(&mut self, command: &Command) {
        let Some(mut path) = command.operand(0).and_then(attr::path) else {
            self.report.add(report::ATTRIBUTE_INVALID);
            return;
        };
        let target = match path.node.clone() {
            Some(name) => self.find(&name),
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

    /// Pours a slice into a node's attribute, creating it on first write.
    fn write(&mut self, target: usize, key: &str, at: usize, value: Attr) -> bool {
        let attrs = &mut self.nodes[target].attrs;
        let mut slot = attrs.remove(key).unwrap_or_else(|| value.empty_like());
        let written = slot.splice(at, value);
        attrs.insert(key.to_string(), slot);
        written
    }

    /// `connectAttr "source.attribute" "target.attribute"`: a noted connection, resolved later.
    pub(super) fn connect(&mut self, command: &Command) {
        let mut ends = (0..2)
            .filter_map(|rank| command.operand(rank))
            .filter_map(|written| written.split_once('.'));
        match (ends.next(), ends.next()) {
            (Some((source, source_attr)), Some((target, target_attr))) => self.links.push(Link {
                source: source.to_string(),
                source_attr: source_attr.to_string(),
                target: target.to_string(),
                target_attr: target_attr.to_string(),
            }),
            _ => self.report.add(report::ATTRIBUTE_INVALID),
        }
    }

    /// `currentUnit -l <unit> -a <unit>`: the scene unit, whose root will carry the factor.
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

    /// `parent -add` of meshed shapes under another transform: instances. Any other form of the
    /// command is counted — replaying a branch move would change the scene.
    pub(super) fn reparent(&mut self, command: &Command) {
        let written: Vec<String> = command
            .operands
            .iter()
            .map(|token| token.text().to_string())
            .collect();
        let mut named: Vec<usize> = Vec::new();
        for token in &written {
            named.extend(self.find(token));
        }
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

    /// Node that `select` names, when this file carries it. Maya's default nodes — `:time1`,
    /// `:renderPartition` — are not created by the file: they are not found, and the `setAttr`
    /// that follow them are counted rather than poured onto a node at random.
    pub(super) fn selected(&mut self, command: &Command) -> Option<usize> {
        let last = command.operands.last()?.text().to_string();
        self.find(&last)
    }
}

/// Factor of a Maya linear unit into metres, short name or long name.
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

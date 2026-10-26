//! The tests' reading of the records the cook wrote (`../records.rs`, `../dag_records.rs`): the table
//! and the DAG decoded back from their bytes, as a reader views them, into one document whose keys
//! name each field, so a test reads what a load reads. Every record's stride is named here once.
use crate::hlod::chain::records::{DAG_MAGIC, TABLE_MAGIC};
use crate::hlod::chain::*;
use trillion3d_page_codec::culling::CULLING_STRIDE;

/// The table's header, bundle, page and HLOD cell strides (`encode_table`).
const TABLE_STRIDES: [usize; 4] = [64, 56, 24, 124];
/// The DAG's header, cluster, group and culling-node strides (`encode_dag`).
const DAG_STRIDES: [usize; 4] = [24, 188, 64, CULLING_STRIDE * 8];

/// The byte after `counts` records of `strides` past its header: where the pool begins.
fn pool_at(strides: &[usize], counts: &[usize]) -> usize {
    strides[0]
        + (strides[1..].iter().zip(counts))
            .map(|(s, n)| s * n)
            .sum::<usize>()
}

/// The pool of `pool` words fills `bytes` exactly after its records at `at`.
pub(crate) fn filled(bytes: &[u8], at: usize, pool: usize) {
    assert_eq!(
        bytes.len(),
        at + pool * 4,
        "records, then the pool, fill the file"
    );
}

/// A cursor over little-endian records and the pool after them.
struct Reader<'a> {
    pub(crate) bytes: &'a [u8],
    pub(crate) at: usize,
    pool: usize,
}
impl Reader<'_> {
    fn word(&mut self) -> u32 {
        self.at += 4;
        u32::from_le_bytes(self.bytes[self.at - 4..self.at].try_into().unwrap())
    }
    pub(crate) fn index(&mut self) -> Value {
        match self.word() {
            u32::MAX => Value::Null,
            n => json!(n),
        }
    }
    pub(crate) fn f64(&mut self) -> f64 {
        self.at += 8;
        f64::from_le_bytes(self.bytes[self.at - 8..self.at].try_into().unwrap())
    }
    fn float(&mut self) -> Value {
        let value = self.f64();
        if value.is_nan() {
            Value::Null
        } else {
            json!(value)
        }
    }
    pub(crate) fn floats(&mut self, count: usize) -> Value {
        let values: Vec<Value> = (0..count).map(|_| self.float()).collect();
        if values.iter().all(Value::is_null) {
            Value::Null
        } else {
            json!(values)
        }
    }
    fn digest(&mut self) -> String {
        self.at += 32;
        crate::hex_of(&self.bytes[self.at - 32..self.at])
    }
    /// A pooled list: its first word and length, read in the pool.
    fn pooled(&mut self) -> Value {
        let (first, count) = (self.word() as usize, self.word() as usize);
        let at = self.pool + first * 4;
        let mut list = Reader {
            bytes: self.bytes,
            at,
            pool: 0,
        };
        json!((0..count).map(|_| list.index()).collect::<Vec<_>>())
    }
}

/// The table's bundles, pages and HLOD cells, as `encode_table` lays them, with its pool's length
/// in words.
pub(crate) fn table(bytes: &[u8]) -> Value {
    assert_eq!(&bytes[..4], TABLE_MAGIC);
    let mut r = Reader {
        bytes,
        at: 4,
        pool: 0,
    };
    let [version, bundles, pages, hlod, pool] = [(); 5].map(|_| r.word() as usize);
    let length = r.word() as u64 | (r.word() as u64) << 32;
    let sha256 = r.digest();
    r.pool = pool_at(&TABLE_STRIDES, &[bundles, pages, hlod]);
    filled(bytes, r.pool, pool);
    let bundles: Vec<Value> = (0..bundles)
        .map(|_| {
            let offset = r.word() as u64 | (r.word() as u64) << 32;
            json!({"offset":offset,"bytes":r.word(),"count":r.word(),"dependencies":r.pooled(),
                "sha256":r.digest()})
        })
        .collect();
    let pages: Vec<Value> = (0..pages)
        .map(|_| {
            json!({"bundle":r.word(),"offset":r.word(),"level":r.word(),"bytes":r.word(),
                "lodError":r.float()})
        })
        .collect();
    let hlod: Vec<Value> = (0..hlod)
        .map(|_| {
            let (bundles, parent, word) = (r.pooled(), r.index(), r.word());
            // Its actor's rows: the bundle holding them and their count (`lay_rows`).
            let (actor_level, rows) = (r.word(), json!({"bundle":r.index(),"count":r.word()}));
            // The level in the low 8 bits, the warm-up in the next bit, the grid in the high 16
            // (`encode_table`).
            json!({"bundles":bundles,"parent":parent,"level":word & 0xff,
                "warmup":((word >> 8) & 1) == 1,"grid":word >> 16,"actorLevel":actor_level,
                "rows":rows,"bounds":r.floats(6),"content":r.floats(6)})
        })
        .collect();
    json!({"version":version,"payload":{"bytes":length,"sha256":sha256},"bundles":bundles,
        "pages":pages,"hlod":hlod,"poolWords":pool})
}

/// The DAG's clusters, groups and culling nodes (each its `CULLING_STRIDE` `f64`, `CullingNode::flat`), as
/// `encode_dag` lays them, with its pool's length in words.
pub(crate) fn dag(bytes: &[u8]) -> Value {
    assert_eq!(&bytes[..4], DAG_MAGIC);
    let mut r = Reader {
        bytes,
        at: 4,
        pool: 0,
    };
    let [version, clusters, groups, pool, nodes] = [(); 5].map(|_| r.word() as usize);
    assert_eq!(version, WORLD_ROOTS_VERSION as usize);
    r.pool = pool_at(&DAG_STRIDES, &[clusters, groups, nodes]);
    filled(bytes, r.pool, pool);
    let clusters: Vec<Value> = (0..clusters)
        .map(|slot| {
            let mut c = json!({"cluster":slot,"level":r.word(),"triangles":r.word(),
                "material":r.index(),"bundle":r.index(),"offset":r.index(),"hlod":r.word(),
                "pad":[r.word(), r.word()],"lodError":r.float(),"parentError":r.float(),"sphere":r.floats(4),
                "parentSphere":r.floats(4),"min":r.floats(3),"max":r.floats(3)});
            let facts = [(); 7].map(|_| r.word());
            if facts[0] > 0 {
                c["page"] = json!({"pageBytes":facts[0],"vertexCount":facts[1],
                    "indexCount":facts[2],"flags":facts[3],"uncompressedBytes":facts[4],
                    "residentBytes":facts[5],"residentOffset":facts[6]});
            }
            c
        })
        .collect();
    let groups: Vec<Value> = (0..groups)
        .map(|_| {
            let group = json!({"level":r.word(),"children":r.pooled(),"outputs":r.pooled()});
            r.word();
            let mut group = group;
            group["error"] = r.float();
            group["sphere"] = r.floats(4);
            group
        })
        .collect();
    let culling: Vec<Vec<f64>> = (0..nodes)
        .map(|_| (0..CULLING_STRIDE).map(|_| r.f64()).collect())
        .collect();
    json!({"clusters":clusters,"groups":groups,"culling":culling,"poolWords":pool})
}

/// What a load reads of `cooked`: its table, with the DAG's `clusters`, `groups`, `culling` nodes
/// and `dagPoolWords`.
pub(crate) fn decoded(cooked: &Cooked) -> Value {
    let mut out = table(&cooked.table);
    let mut dag = dag(&cooked.dag);
    for key in ["clusters", "groups", "culling"] {
        out[key] = dag[key].take();
    }
    out["dagPoolWords"] = dag["poolWords"].take();
    out
}

/// The cluster of `table` (`decoded`) whose page lies at `offset` of bundle `bundle`.
fn world_cluster(table: &Value, bundle: u64, offset: u64) -> &Value {
    (table["clusters"].as_array().expect("clusters").iter())
        .find(|c| c["bundle"] == json!(bundle) && c["offset"] == json!(offset))
        .expect("a cluster at that place")
}

/// The bytes of the page of `cluster` in `payload`, its bundle's start and its own offset there.
fn world_bytes<'a>(table: &Value, payload: &'a [u8], cluster: &Value) -> &'a [u8] {
    let at = |value: &Value| value.as_u64().expect("a number") as usize;
    let start = at(&table["bundles"][at(&cluster["bundle"])]["offset"]) + at(&cluster["offset"]);
    &payload[start..start + at(&cluster["page"]["pageBytes"])]
}

/// A number of the decoded table.
fn number(value: &Value) -> usize {
    value.as_u64().expect("a number") as usize
}

/// The pages of a cooked world (`table` as `decoded` gives it, the pages in `payload`). A page is
/// expanded to its resident page ONCE, whoever names it: the vertices a page names are found in the
/// resident pages of the clusters it names them in, each expanded from its own references the same
/// way, never decoded again for each reference.
pub(crate) struct WorldPages<'a> {
    table: &'a Value,
    payload: &'a [u8],
    /// The cluster at each place: its bundle and its offset in the pool there, in bytes.
    places: std::collections::HashMap<(usize, usize), &'a Value>,
    /// The resident page of each cluster place, once expanded.
    residents: std::collections::HashMap<(usize, usize), Vec<u8>>,
}

impl<'a> WorldPages<'a> {
    pub(crate) fn new(table: &'a Value, payload: &'a [u8]) -> Self {
        let places = (table["clusters"].as_array().expect("clusters").iter())
            .map(|c| {
                (
                    (number(&c["bundle"]), number(&c["page"]["residentOffset"])),
                    c,
                )
            })
            .collect();
        Self {
            table,
            payload,
            places,
            residents: Default::default(),
        }
    }

    /// The page at `offset` of bundle `bundle` decoded whole: the vertices it names found in the
    /// pages it names them in.
    pub(crate) fn page(
        &mut self,
        (bundle, offset): (u64, u64),
    ) -> trillion3d_page_codec::DecodedPage {
        let (table, payload) = (self.table, self.payload);
        let cluster = world_cluster(table, bundle, offset);
        let named = self.named(cluster);
        let named: Vec<&[u8]> = named.iter().map(Vec::as_slice).collect();
        let bytes = world_bytes(table, payload, cluster);
        trillion3d_page_codec::decode_with(bytes, 1 << 24, &named).expect("a WGP3 page")
    }

    /// The resident page of each cluster the page of `cluster` names a vertex of, in the order of
    /// its pairs (`tests::base::PrimitivePages`: the rank in the bundle's dependencies, above the
    /// words to the cluster in its bundle's place in the pool).
    fn named(&mut self, cluster: &Value) -> Vec<Vec<u8>> {
        let (table, payload) = (self.table, self.payload);
        let bytes = world_bytes(table, payload, cluster);
        let raw = trillion3d_page_codec::disk::read_raw(bytes, usize::MAX).expect("a WGP3 page");
        let own = number(&cluster["bundle"]);
        let dependencies = table["bundles"][own]["dependencies"]
            .as_array()
            .expect("dependencies");
        crate::tests::base::named_pages(
            &raw.refs.pairs,
            own,
            |rank| number(&dependencies[rank - 1]),
            |bundle, place| {
                let target = (self.places.get(&(bundle, place * 4)).copied())
                    .expect("the cluster a pair names");
                self.resident(target)
            },
        )
    }

    /// The resident page of `cluster`, expanded the first time it is asked for.
    fn resident(&mut self, cluster: &Value) -> Vec<u8> {
        let key = (
            number(&cluster["bundle"]),
            number(&cluster["page"]["residentOffset"]),
        );
        if let Some(done) = self.residents.get(&key) {
            return done.clone();
        }
        let (table, payload) = (self.table, self.payload);
        let named = self.named(cluster);
        let named: Vec<&[u8]> = named.iter().map(Vec::as_slice).collect();
        let bytes = world_bytes(table, payload, cluster);
        let resident = trillion3d_page_codec::resident::expand(bytes, usize::MAX, &named)
            .expect("a resident page");
        self.residents.insert(key, resident.clone());
        resident
    }
}

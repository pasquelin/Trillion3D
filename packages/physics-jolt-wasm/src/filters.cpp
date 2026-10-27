// The filter table (`filters.h`) and the FILTER command that fills it.
#include "filters.h"

#include "layout.h"
#include "words.h"

#include <vector>

namespace trillion {

namespace {

// Words of a FILTER command (layout.ts FILTER) and of a trace's channel and answers (layout.ts CAST).
constexpr uint32_t FILTER_ID = 1, FILTER_CHANNEL = 2, FILTER_SWITCHES = 3, FILTER_BLOCK = 4, FILTER_OVERLAP = 6;
constexpr uint32_t QUERY_CHANNEL = 0, QUERY_BLOCK = 1, QUERY_OVERLAP = 3;

constexpr uint32_t NO_RANK = ~uint32_t(0);
// The pair table covers this many filters; a page that defines more is answered filter by filter.
constexpr uint32_t PAIR_RANKS = 512;
constexpr uint8_t BOTH_STILL = 4;

std::vector<Filter> table;
std::vector<uint32_t> ranks;  // by object layer: its place among the defined filters
std::vector<uint32_t> layers; // by rank: the object layer
// Per pair of ranks, `taken` of their filters, with `BOTH_STILL` when neither moves.
std::vector<uint8_t> pairs;
const Filter none;

uint8_t pairOf(const Filter &a, const Filter &b) {
  return uint8_t(taken(a, b)) | (a.still && b.still ? BOTH_STILL : 0);
}

uint32_t rankOf(JPH::ObjectLayer layer) { return layer < ranks.size() ? ranks[layer] : NO_RANK; }

uint8_t pairOfLayers(JPH::ObjectLayer a, JPH::ObjectLayer b) {
  const uint32_t x = rankOf(a), y = rankOf(b);
  return x < PAIR_RANKS && y < PAIR_RANKS ? pairs[x * PAIR_RANKS + y] : pairOf(filterOf(a), filterOf(b));
}

/// Adds the filter of layer `id` to the pair table.
void rank(uint32_t id) {
  const uint32_t added = uint32_t(layers.size());
  if (id >= ranks.size()) ranks.resize(id + 1, NO_RANK);
  ranks[id] = added;
  layers.push_back(id);
  if (added >= PAIR_RANKS) return;
  if (pairs.empty()) pairs.assign(PAIR_RANKS * PAIR_RANKS, 0);
  for (uint32_t other = 0; other <= added; ++other)
    pairs[added * PAIR_RANKS + other] = pairs[other * PAIR_RANKS + added] = pairOf(table[id], table[layers[other]]);
}

}  // namespace

const Filter &filterOf(JPH::ObjectLayer layer) { return layer < table.size() ? table[layer] : none; }

Meeting takenLayers(JPH::ObjectLayer a, JPH::ObjectLayer b) { return Meeting(pairOfLayers(a, b) & ~BOTH_STILL); }

bool layersCollide(JPH::ObjectLayer a, JPH::ObjectLayer b) {
  const uint8_t pair = pairOfLayers(a, b);
  return !(pair & BOTH_STILL) && Meeting(pair) != Meeting::Ignore;
}

bool defineFilter(const uint32_t *w) {
  const uint32_t id = w[FILTER_ID];
  if (id >= MAX_FILTERS || w[FILTER_CHANNEL] > 63) return false;
  Filter f;
  f.channel = uint8_t(w[FILTER_CHANNEL]);
  f.query = (w[FILTER_SWITCHES] & FILTER_QUERY) != 0;
  f.physics = (w[FILTER_SWITCHES] & FILTER_PHYSICS) != 0;
  f.still = (w[FILTER_SWITCHES] & FILTER_STILL) != 0;
  f.block = u64(w + FILTER_BLOCK);
  f.overlap = u64(w + FILTER_OVERLAP);
  f.defined = true;
  if (id >= table.size()) table.resize(id + 1);
  // A filter never changes: the same one sent again is accepted, another under its id is not.
  if (table[id].defined) return table[id] == f;
  table[id] = f;
  rank(id);
  return true;
}

LayerMeets::LayerMeets(const Query &query, Meeting least)
    : accepted(layers.size()), undefined(queried(query, none) >= least) {
  for (size_t rank = 0; rank < layers.size(); ++rank) accepted[rank] = queried(query, table[layers[rank]]) >= least;
}

bool LayerMeets::ShouldCollide(JPH::ObjectLayer layer) const {
  const uint32_t rank = rankOf(layer);
  return rank == NO_RANK ? undefined : accepted[rank] != 0;
}

Query traceQuery(const uint32_t *w) {
  Query query;
  query.filter.channel = uint8_t(w[QUERY_CHANNEL] & 63);
  query.filter.block = u64(w + QUERY_BLOCK);
  query.filter.overlap = u64(w + QUERY_OVERLAP);
  return query;
}

Query objectQuery(const uint32_t *w) {
  Query query;
  query.byObject = true;
  query.objects = u64(w);
  return query;
}

void clearFilters() {
  table.clear();
  ranks.clear();
  layers.clear();
  pairs.clear();
  // The four the page names without defining (layout.ts BUILT_IN_FILTER): static ground that
  // blocks all, a moving physics body, debris that meets the static ground alone, the pawn.
  const uint64_t all = ~uint64_t(0);
  const uint32_t def[4][8] = {
      {FILTER, 0, 0, FILTER_QUERY | FILTER_PHYSICS | FILTER_STILL, uint32_t(all), uint32_t(all >> 32), 0, 0},
      {FILTER, 1, 5, FILTER_QUERY | FILTER_PHYSICS, uint32_t(all), uint32_t(all >> 32), 0, 0},
      {FILTER, 2, 5, FILTER_QUERY | FILTER_PHYSICS, 1, 0, 0, 0},
      // The pawn: channel 2, blocking every channel but the visibility's (3).
      {FILTER, 3, 2, FILTER_QUERY | FILTER_PHYSICS, uint32_t(all & ~(uint64_t(1) << 3)), uint32_t(all >> 32), 0, 0}};
  for (const auto &w : def) defineFilter(w);
}

}  // namespace trillion

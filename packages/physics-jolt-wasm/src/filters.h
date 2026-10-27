// Collision filters: what a body is to the others (layout.ts FILTER). The page defines each filter
// once, named by an id that is the body's Jolt object layer; Jolt's pair filters, the contact
// listener and the overlap queries all read the table below. Two bodies meet by the lesser of what
// each answers to the other's channel, and a meeting is a collision only where both bodies take
// part in the simulation and an overlap only where both take part in the queries.
#pragma once

#include <Jolt/Jolt.h>

#include <Jolt/Physics/Body/Body.h>
#include <Jolt/Physics/Body/BodyFilter.h>
#include <Jolt/Physics/Collision/ObjectLayer.h>

#include <cstdint>
#include <vector>

namespace trillion {

/// One body kind: its channel (a bit of the masks), the channels it blocks and overlaps, and its
/// switches. `defined` is false for an id the page never defined.
struct Filter {
  uint64_t block = 0, overlap = 0;
  uint8_t channel = 0;
  bool query = true, physics = true, still = false, defined = false;
  uint64_t bit() const { return uint64_t(1) << channel; }
  /// The same filter, whether or not either was defined.
  bool operator==(const Filter &o) const {
    return block == o.block && overlap == o.overlap && channel == o.channel && query == o.query &&
           physics == o.physics && still == o.still;
  }
};

/// What two bodies are to each other.
enum class Meeting : uint8_t { Ignore, Overlap, Block };

/// What a body (or a query) answers to channel `bit`: the least, `Ignore`, to the most, `Block`.
inline Meeting answer(const Filter &f, uint64_t bit) {
  return (f.block & bit) ? Meeting::Block : (f.overlap & bit) ? Meeting::Overlap : Meeting::Ignore;
}

/// The lesser of what each answers to the other's channel.
inline Meeting meet(const Filter &a, const Filter &b) {
  Meeting x = answer(a, b.bit()), y = answer(b, a.bit());
  return x < y ? x : y;
}

/// How the simulation takes two bodies: a collision (`Block`) where both are simulated, an
/// overlap where both are queried, nothing otherwise.
inline Meeting taken(const Filter &a, const Filter &b) {
  Meeting m = meet(a, b);
  if (m == Meeting::Block) return a.physics && b.physics ? Meeting::Block : Meeting::Ignore;
  if (m == Meeting::Overlap) return a.query && b.query ? Meeting::Overlap : Meeting::Ignore;
  return Meeting::Ignore;
}

/// A scene query's side of a meeting: a channel and the answers it gives to channels (`filter`), or
/// the object types it seeks (`byObject`, `objects` their channels' bits).
struct Query {
  Filter filter;
  uint64_t objects = 0;
  bool byObject = false;
};

/// What `query` meets in `body`: only a body that takes part in the queries is met; by channel,
/// by what each answers to the other's channel; by object type, a body whose channel is among
/// the types, as a block.
inline Meeting queried(const Query &query, const Filter &body) {
  if (!body.query) return Meeting::Ignore;
  if (query.byObject) return (body.bit() & query.objects) ? Meeting::Block : Meeting::Ignore;
  return meet(query.filter, body);
}

/// The object layers `query` meets at `least` in: Jolt's filter of the layers a scene query visits,
/// answered from a mask worked out once for the defined filters.
class LayerMeets final : public JPH::ObjectLayerFilter {
public:
  LayerMeets(const Query &query, Meeting least);
  bool ShouldCollide(JPH::ObjectLayer layer) const override;

private:
  std::vector<uint8_t> accepted;  // by the filter's rank among the defined
  bool undefined;                 // the answer for a layer no filter defines
};

/// Every body but the one whose engine id a query names: the body it passes through.
class IgnoredBody final : public JPH::BodyFilter {
public:
  explicit IgnoredBody(uint32_t engine) : engine(engine) {}
  bool ShouldCollideLocked(const JPH::Body &body) const override {
    return uint32_t(body.GetUserData()) != engine;
  }

private:
  uint32_t engine;
};

/// The channel of a query and the answers it gives, read from five words: `channel, block low,
/// block high, overlap low, overlap high` (layout.ts CAST, OVERLAP).
Query traceQuery(const uint32_t *w);
/// The query that seeks the bodies whose channel is among the object types of two words, `low,
/// high` (layout.ts CAST, OVERLAP): each one it meets blocks, whatever it answers.
Query objectQuery(const uint32_t *w);

/// How the simulation takes the bodies of layers `a` and `b` (`taken`), from a table filled as the
/// filters are defined.
Meeting takenLayers(JPH::ObjectLayer a, JPH::ObjectLayer b);
/// Whether Jolt tests the bodies of layers `a` and `b` against each other: not two that never move,
/// the others where the simulation takes their meeting.
bool layersCollide(JPH::ObjectLayer a, JPH::ObjectLayer b);

/// The filter of object layer `layer`; an undefined id answers like a filter that meets nothing.
const Filter &filterOf(JPH::ObjectLayer layer);
/// Defines the filter a FILTER command (`w`) describes; false when its id is out of range or taken.
bool defineFilter(const uint32_t *w);
/// Forgets every filter (a new world).
void clearFilters();

}  // namespace trillion

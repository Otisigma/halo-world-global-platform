// HALO Orbits / SERENA Mesh layout. Pure geometry so the visualizer can be tested without a DOM.
import { ORBIT_TIERS, ORBIT_TIER_IDS } from "./halo-creator-seed.js";

const round = value => Math.round(value * 100) / 100;

export function orbitTierFor(node) {
  return ORBIT_TIER_IDS.includes(node?.orbitTier) ? node.orbitTier : "public";
}

export function layoutOrbits(nodes = [], { size = 640 } = {}) {
  const center = size / 2;
  const step = (size / 2 - 28) / ORBIT_TIERS.length;
  const rings = ORBIT_TIERS.map(tier => ({
    ...tier,
    radius: round(tier.ring === 0 ? step * 0.55 : step * (tier.ring + 0.55))
  }));
  const byTier = new Map(rings.map(ring => [ring.id, []]));
  for (const node of nodes) byTier.get(orbitTierFor(node)).push(node);
  const placed = [];
  rings.forEach((ring, ringIndex) => {
    const members = byTier.get(ring.id);
    const offset = -Math.PI / 2 + ringIndex * 0.6;
    members.forEach((node, index) => {
      const angle = offset + (2 * Math.PI * index) / members.length;
      const radius = ring.ring === 0 && members.length === 1 ? 0 : ring.radius;
      placed.push({
        ...node,
        tier: ring.id,
        tierLabel: ring.label,
        angle: round(angle),
        x: round(center + radius * Math.cos(angle)),
        y: round(center + radius * Math.sin(angle))
      });
    });
  });
  return {
    size,
    center,
    rings: rings.map(ring => ({ ...ring, count: byTier.get(ring.id).length })),
    nodes: placed
  };
}

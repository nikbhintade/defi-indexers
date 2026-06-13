#!/usr/bin/env node
/**
 * Harvest the top-N DeFi protocols by current TVL from DefiLlama and emit a
 * compact JSON the repo-discovery step consumes.
 *
 * Requires network egress for api.llama.fi (not on the default sandbox
 * allowlist). Run: node tools/defillama/harvest.mjs [N] > tools/defillama/top.json
 */
import { argv } from "node:process";

const N = Number(argv[2] || 300);

const res = await fetch("https://api.llama.fi/protocols");
if (!res.ok) {
  console.error(`api.llama.fi/protocols: HTTP ${res.status} ${await res.text()}`);
  process.exit(1);
}
const all = await res.json();

// Some entries are sub-protocols / double-counts; DefiLlama's own ranking uses
// `tvl` on the /protocols feed. Sort desc, drop null-tvl, take N.
const ranked = all
  .filter((p) => typeof p.tvl === "number" && p.tvl > 0)
  .sort((a, b) => b.tvl - a.tvl)
  .slice(0, N)
  .map((p, i) => ({
    rank: i + 1,
    name: p.name,
    slug: p.slug,
    tvl: Math.round(p.tvl),
    category: p.category ?? null,
    chains: p.chains ?? [],
    url: p.url ?? null,
    // `github` is an array of org/user handles DefiLlama tracks for the adapter
    github: p.github ?? [],
    twitter: p.twitter ?? null,
    oracles: p.oracles ?? [],
  }));

console.log(JSON.stringify(ranked, null, 2));
console.error(`Wrote ${ranked.length} protocols (of ${all.length} tracked).`);

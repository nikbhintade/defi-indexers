#!/usr/bin/env node
/**
 * Merge per-batch discovery results (tools/defillama/results/*.json) and render
 * the "Migration candidates" markdown table — only protocols with a confirmed
 * public subgraph/indexer repo. Also prints coverage stats to stderr.
 *
 * Each results file is a JSON array of rows:
 *   { rank, name, slug, category, tvl_usd, has_public_indexer,
 *     repos: [{ url, type, scope, maintained, verified }], notes }
 *
 * Run: node tools/defillama/render.mjs > tools/defillama/CANDIDATES.snippet.md
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = "tools/defillama/results";
const rows = [];
for (const f of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
  const arr = JSON.parse(readFileSync(join(dir, f), "utf8"));
  for (const r of arr) rows.push(r);
}
rows.sort((a, b) => a.rank - b.rank);

// dedupe by rank (in case batches overlap)
const byRank = new Map();
for (const r of rows) if (!byRank.has(r.rank)) byRank.set(r.rank, r);
const all = [...byRank.values()].sort((a, b) => a.rank - b.rank);

const ported = {
  "morpho-blue": "spiko-morpho", "compound-v3": "compound-v3",
  "compound-v2": "compound-v2", "convex-finance": "convex",
  "pancakeswap-amm": "pancakeswap-exchange", "curve-dex": "curve-volume",
  "pendle": "pendle", "spiko": "spiko-morpho", "venus-core-pool": "venus",
  "anemoy-capital": "anemoy-centrifuge", "ether.fi-stake": "(skipped)",
};

const withRepo = all.filter((r) => r.has_public_indexer && r.repos?.length);
const fmtTvl = (n) => (n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : `$${(n / 1e6).toFixed(0)}M`);

const lines = [];
lines.push("| # | Protocol | TVL | Category | Indexer type | Repo(s) | Notes |");
lines.push("|---|----------|-----|----------|--------------|---------|-------|");
for (const r of withRepo) {
  const repos = r.repos.map((x) => `[${x.type}](${x.url})`).join("<br>");
  const note = [
    ported[r.slug] ? `**already ported → \`${ported[r.slug]}\`**` : "",
    r.repos.map((x) => x.scope).filter(Boolean)[0] || "",
    r.notes || "",
  ].filter(Boolean).join("; ");
  lines.push(`| ${r.rank} | ${r.name} | ${fmtTvl(r.tvl_usd)} | ${r.category} | ${r.repos.map((x) => x.maintained).join("/")} | ${repos} | ${note} |`);
}
console.log(lines.join("\n"));

console.error(`merged rows: ${all.length} / 300`);
console.error(`with public indexer: ${withRepo.length}`);
const missingRanks = [];
for (let i = 1; i <= 300; i++) if (!byRank.has(i)) missingRanks.push(i);
if (missingRanks.length) console.error(`MISSING ranks (no result row): ${missingRanks.join(",")}`);

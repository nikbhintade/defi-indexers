#!/usr/bin/env node
/**
 * Cross-validate a local HyperIndex (Hasura) database against the original
 * subgraph deployment, entity by entity.
 *
 * Usage: node tools/compare/compare.mjs --config <protocol>/validation.json
 *
 * Requires network access to the subgraph endpoint (gateway.thegraph.com or
 * similar) and a running local indexer (http://localhost:8080).
 */
import { readFileSync } from "node:fs";
import { argv, env, exit } from "node:process";

const configPath = argv[argv.indexOf("--config") + 1];
if (!configPath || configPath.startsWith("--")) {
  console.error("Usage: node compare.mjs --config <validation.json>");
  exit(1);
}
const cfg = JSON.parse(readFileSync(configPath, "utf8"));
const PAGE = 1000;
const decimalTolerance = cfg.decimalTolerance ?? 1e-6;

async function gql(url, query, variables, headers = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status} ${await res.text()}`);
  const body = await res.json();
  if (body.errors) throw new Error(`${url}: ${JSON.stringify(body.errors)}`);
  return body.data;
}

function subgraphHeaders() {
  const key = cfg.subgraph.authEnv ? env[cfg.subgraph.authEnv] : undefined;
  return key ? { Authorization: `Bearer ${key}` } : {};
}

async function fetchSubgraphEntities(ent) {
  const rows = [];
  let lastId = "";
  for (;;) {
    const block = cfg.blockRange?.end ? `block: {number: ${cfg.blockRange.end}},` : "";
    const q = `query($lastId: ID!) { rows: ${ent.subgraphName}(first: ${PAGE}, ${block} where: {id_gt: $lastId}, orderBy: id, orderDirection: asc) { ${ent.fields.join(" ")} } }`;
    const data = await gql(cfg.subgraph.url, q, { lastId }, subgraphHeaders());
    rows.push(...data.rows);
    if (data.rows.length < PAGE) break;
    lastId = data.rows[data.rows.length - 1].id;
  }
  return rows;
}

async function fetchLocalEntities(ent) {
  const rows = [];
  let offset = 0;
  const headers = cfg.local.adminSecret ? { "x-hasura-admin-secret": cfg.local.adminSecret } : {};
  for (;;) {
    const q = `query($offset: Int!) { rows: ${ent.localName}(limit: ${PAGE}, offset: $offset, order_by: {id: asc}) { ${ent.fields.join(" ")} } }`;
    const data = await gql(cfg.local.url, q, { offset }, headers);
    rows.push(...data.rows);
    if (data.rows.length < PAGE) break;
    offset += PAGE;
  }
  return rows;
}

function normalize(v, isDecimal) {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v.map((x) => normalize(x, isDecimal));
  if (typeof v === "object") return normalize(v.id, false); // nested ref -> id
  if (isDecimal) return v; // compared numerically later
  if (typeof v === "string") return v.toLowerCase();
  return String(v);
}

function decimalsEqual(a, b) {
  if (a === null || b === null) return a === b;
  const na = Number(a), nb = Number(b);
  if (Number.isNaN(na) || Number.isNaN(nb)) return String(a) === String(b);
  if (na === 0 && nb === 0) return true;
  return Math.abs(na - nb) / Math.max(Math.abs(na), Math.abs(nb), 1e-30) <= decimalTolerance;
}

let failures = 0;
for (const ent of cfg.entities) {
  const decimalFields = new Set(ent.decimalFields ?? []);
  process.stdout.write(`\n== ${ent.subgraphName} (subgraph) vs ${ent.localName} (local) ==\n`);
  const [sg, local] = await Promise.all([fetchSubgraphEntities(ent), fetchLocalEntities(ent)]);
  const localById = new Map(local.map((r) => [String(r.id).toLowerCase(), r]));
  console.log(`subgraph rows: ${sg.length}, local rows: ${local.length}`);
  if (sg.length !== local.length) {
    failures++;
    console.log(`  ROW COUNT MISMATCH`);
  }
  let fieldMismatches = 0, missing = 0;
  for (const row of sg) {
    const id = String(row.id).toLowerCase();
    const mine = localById.get(id);
    if (!mine) {
      missing++;
      if (missing <= 5) console.log(`  MISSING locally: ${id}`);
      continue;
    }
    for (const f of ent.fields) {
      if (f === "id") continue;
      const a = normalize(row[f], decimalFields.has(f));
      const b = normalize(mine[f], decimalFields.has(f));
      const equal = decimalFields.has(f) ? decimalsEqual(a, b) : JSON.stringify(a) === JSON.stringify(b);
      if (!equal) {
        fieldMismatches++;
        if (fieldMismatches <= 10)
          console.log(`  DIFF ${id}.${f}: subgraph=${JSON.stringify(a)} local=${JSON.stringify(b)}`);
      }
    }
  }
  if (missing > 5) console.log(`  ... and ${missing - 5} more missing`);
  if (fieldMismatches > 10) console.log(`  ... and ${fieldMismatches - 10} more field diffs`);
  if (missing || fieldMismatches) failures++;
  else if (sg.length === local.length) console.log(`  OK — ${sg.length} rows match`);
}

console.log(failures ? `\nFAILED: ${failures} entity set(s) with differences` : "\nALL ENTITY SETS MATCH");
exit(failures ? 1 : 0);

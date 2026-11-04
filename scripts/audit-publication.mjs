#!/usr/bin/env node
/**
 * Scan the repository for terms that must not be published. The term list stays outside this repository, because
 * listing the words here would itself be a reference: pass its path, one term per line.
 *
 *   node scripts/audit-publication.mjs path/to/terms.txt
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const list = process.argv[2];
if (!list) {
  console.error("usage: node scripts/audit-publication.mjs path/to/terms.txt");
  process.exit(2);
}
const terms = readFileSync(list, "utf8")
  .split(/\r?\n/)
  .map((t) => t.trim().toLowerCase())
  .filter(Boolean);
const skip = new Set(["node_modules", ".git", "out", "coverage", "test-results", "playwright-report"]);
const binary = new Set([".ttf", ".wasm", ".png", ".3mf"]);
const root = process.cwd();
const hits = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      walk(path);
    } else if (!binary.has(extname(name)) && name !== "package-lock.json") {
      readFileSync(path, "utf8")
        .split("\n")
        .forEach((line, i) => {
          const low = line.toLowerCase();
          for (const t of terms) if (low.includes(t)) hits.push(`${relative(root, path)}:${i + 1}: ${t}`);
        });
    }
  }
}

walk(root);
for (const hit of hits) console.log(hit);
console.log(hits.length ? `RESULT: FAIL, ${hits.length} hits` : "RESULT: PASS");
process.exit(hits.length ? 1 : 0);

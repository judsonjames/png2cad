/**
 * Writes sw.js after a build: a service worker that keeps every built file, so an installed app opens without a
 * connection. The cache is named after a hash of the files, so each deploy gets a new cache, and the same build always
 * gives the same worker.
 *
 * A new version waits until every window of the app is closed before it takes over. Swapping files under a running app
 * could break the parts it loads on demand, such as the 3D view, so updates arrive on the next launch.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { Plugin } from "vite";

function filesIn(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesIn(path) : [path];
  });
}

const worker = (
  cache: string,
  files: string[],
) => `// Made by offline.ts at build time. Keeps the app's files so it opens without a connection.
const CACHE = ${JSON.stringify(cache)};
const FILES = ${JSON.stringify(files)};

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("png2cad-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then(
      (kept) =>
        kept ??
        fetch(request).catch((error) => {
          if (request.mode === "navigate") return caches.match("./");
          throw error;
        }),
    ),
  );
});
`;

export function offline(): Plugin {
  let outDir = "";
  return {
    name: "png2cad-offline",
    apply: "build",
    configResolved(config) {
      outDir = join(config.root, config.build.outDir);
    },
    closeBundle() {
      const files = filesIn(outDir)
        .map((path) => relative(outDir, path).split(sep).join("/"))
        .filter((path) => path !== "sw.js")
        .sort();
      const hash = createHash("sha256");
      for (const file of files) hash.update(file).update(readFileSync(join(outDir, file)));
      const list = ["./", ...files.map((file) => `./${file}`)];
      writeFileSync(join(outDir, "sw.js"), worker(`png2cad-${hash.digest("hex").slice(0, 16)}`, list));
    },
  };
}

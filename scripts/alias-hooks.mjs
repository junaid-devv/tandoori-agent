import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const ROOT = process.cwd();

function resolveWithExt(base) {
  // base is an absolute path without guaranteed extension.
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mjs`,
    `${base}.js`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
    path.join(base, "index.mjs"),
    path.join(base, "index.js"),
  ];
  for (const c of candidates) {
    try {
      if (fs.statSync(c).isFile()) return c;
    } catch {
      /* not found, keep trying */
    }
  }
  return base;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const target = resolveWithExt(path.join(ROOT, specifier.slice(2)));
    return nextResolve(pathToFileURL(target).href, context);
  }
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
    const parentDir = path.dirname(fileURLToPath(context.parentURL));
    const target = resolveWithExt(path.resolve(parentDir, specifier));
    return nextResolve(pathToFileURL(target).href, context);
  }
  return nextResolve(specifier, context);
}


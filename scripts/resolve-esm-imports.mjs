import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const outputDir = resolve("dist");

async function visit(directory) {
  for (const entry of await readdir(directory)) {
    const path = join(directory, entry);
    const info = await stat(path);

    if (info.isDirectory()) {
      await visit(path);
      continue;
    }

    if (!entry.endsWith(".js")) continue;

    const source = await readFile(path, "utf8");
    const updated = await replaceExtensionlessImports(source, path);
    if (updated !== source) await writeFile(path, updated);
  }
}

async function replaceExtensionlessImports(source, importer) {
  const pattern = /(from\s*|import\s*(?:\(\s*)?)(["'])(\.{1,2}\/[^"']+)\2/g;
  let updated = source;
  const matches = [...source.matchAll(pattern)];

  for (const match of matches) {
    const specifier = match[3];
    if (specifier.endsWith(".js")) continue;

    try {
      await stat(resolve(dirname(importer), `${specifier}.js`));
      updated = updated.replace(match[0], `${match[1]}${match[2]}${specifier}.js${match[2]}`);
    } catch {
      // Leave non-file specifiers and unresolved imports unchanged.
    }
  }

  return updated;
}

await visit(outputDir);

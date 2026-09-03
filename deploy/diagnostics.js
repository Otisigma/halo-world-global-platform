import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const requiredFiles = [
  "halo.html",
  "index.html",
  path.join("album-concierge", "index.html"),
];

let hasError = false;

for (const filePath of requiredFiles) {
  const fullPath = path.join(root, filePath);
  const exists = fs.existsSync(fullPath);
  console.log(`${exists ? "OK" : "MISSING"} ${filePath}`);
  if (!exists) hasError = true;
}

if (hasError) {
  process.exit(1);
}

console.log("Diagnostics passed");

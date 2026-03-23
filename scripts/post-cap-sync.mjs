import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const packageSwiftPath = resolve("ios/App/CapApp-SPM/Package.swift");

if (!existsSync(packageSwiftPath)) {
  process.exit(0);
}

const current = readFileSync(packageSwiftPath, "utf8");
const localDependency =
  '.package(name: "CapgoCapacitorShareTarget", path: "../CapgoCapacitorShareTargetLocal")';

if (current.includes(localDependency)) {
  process.exit(0);
}

const updated = current.replace(
  /\.package\(name: "CapgoCapacitorShareTarget", path: ".*?"\)/,
  localDependency
);

if (updated === current) {
  throw new Error("Could not patch ios/App/CapApp-SPM/Package.swift for local share target package.");
}

writeFileSync(packageSwiftPath, updated);

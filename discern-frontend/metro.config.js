// Metro has to be told about the MONOREPO or it will not resolve
// @discern/shared: the package lives at ../shared and its dependencies are
// hoisted to the root node_modules, neither of which Metro walks by default.
//
// `disableHierarchicalLookup` is deliberately NOT set. Expo's own guidance
// turns it on to force isolated resolution, but this repo hoists — the shared
// workspace's `zod` is at the ROOT node_modules, not inside shared/ — so
// disabling the upward walk is exactly what breaks it.
const path = require("node:path");

const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

module.exports = config;

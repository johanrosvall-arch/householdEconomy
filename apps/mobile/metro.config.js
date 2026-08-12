// Metro config for a pnpm workspace.
//
// Two things are needed that the default config does not do:
//
//  1. `watchFolders` must include the repo root, or Metro will not notice edits
//     to `packages/shared` and you get stale bundles after changing a type or
//     a helper.
//  2. `nodeModulesPaths` must include the root store, because pnpm keeps most
//     packages there and only symlinks into `apps/mobile/node_modules`.
//
// Note also that `packages/shared` is consumed as TypeScript *source*, not as
// built output, so its imports must be extensionless — Metro does not perform
// TypeScript's `./foo.js` -> `./foo.ts` mapping.

const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Hierarchical lookup is deliberately left ON. Disabling it is common advice
// for npm/yarn workspaces (it prevents a package resolving twice), but it
// breaks pnpm: pnpm stores a package's own dependencies as siblings inside
// `.pnpm/<pkg>/node_modules/`, and walking up from the real path is precisely
// how those transitive deps are found. Turning it off makes every transitive
// import of a hoisted package fail to resolve.

module.exports = config;

import { registerHooks } from "node:module";

// lib/ uses extensionless relative imports (resolved by Next); add ".ts" so
// Node's type stripping can load the same files in unit tests.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[cm]?[jt]sx?$/.test(specifier) && context.parentURL?.includes("/lib/")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

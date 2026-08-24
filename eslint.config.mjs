import coreWebVitals from 'eslint-config-next/core-web-vitals';

/**
 * Flat config. In this version `eslint-config-next/core-web-vitals` is itself a
 * flat-config array — the root `eslint-config-next` export is a *different*
 * array with no named members, so `next.coreWebVitals` throws
 * "not iterable". Import the subpath directly.
 *
 * The @eslint/eslintrc FlatCompat shim documented for older Next versions is
 * also wrong here; it throws on this package.
 */
const config = [
  { ignores: ['.next/**', 'node_modules/**', 'drizzle/**', 'next-env.d.ts'] },
  ...coreWebVitals,
];

export default config;

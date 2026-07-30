/**
 * Node-side helpers for the acceptance test.
 *
 * `src/lib/crypto.ts` is safe to import here, but re-exporting through this
 * module keeps the test's imports stable if hashing ever moves behind a
 * server-only boundary.
 */
export { hashPassword } from '../src/lib/crypto';

export const stableKeyPlaceholder = null;

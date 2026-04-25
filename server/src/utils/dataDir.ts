// Resolves the data directory consistently across services.
// Production uses DATA_DIR (Railway volume mount). Dev defaults to
// server/data/. Mirrors the convention in db/index.ts.

import path from 'path';

export function getDataDir(): string {
  return process.env.DATA_DIR || path.resolve(__dirname, '../../data');
}

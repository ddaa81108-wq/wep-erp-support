import type { DatabaseSync } from 'node:sqlite';

export type Migration = {
  version: number;
  name: string;
  legacyNames?: readonly string[];
  sql: string;
  before?: (database: DatabaseSync) => void;
  after?: (database: DatabaseSync) => void;
};

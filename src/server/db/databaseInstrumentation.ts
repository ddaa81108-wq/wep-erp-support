import { AsyncLocalStorage } from 'node:async_hooks';
import type { DatabaseSync, StatementSync } from 'node:sqlite';
export type OperationKind = 'reads' | 'writes' | 'other';
export type Observation = { kind: OperationKind; milliseconds: number; failed: boolean; busy: boolean };
const excluded = new AsyncLocalStorage<boolean>();
export const withoutDatabaseMeasurement = <T>(work: () => T): T => excluded.run(true, work);
// Remove comments and literals before finding the main command of a CTE.
export function operationKind(sql: string): OperationKind {
  const tokens =
    sql
      .replace(/--[^\r\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|`[^`]*`|\[[^\]]*\]/g, ' ')
      .match(/[a-z_]+|[();]/gi) ?? [];
  let depth = 0;
  for (const token of tokens) {
    if (token === '(') {
      depth++;
      continue;
    }
    if (token === ')') {
      depth--;
      continue;
    }
    if (depth !== 0) continue;
    const command = token.toUpperCase();
    if (command === 'SELECT' || command === 'EXPLAIN') return 'reads';
    if (
      ['INSERT', 'UPDATE', 'DELETE', 'REPLACE', 'CREATE', 'ALTER', 'DROP', 'VACUUM', 'REINDEX'].includes(
        command,
      )
    )
      return 'writes';
    if (['PRAGMA', 'BEGIN', 'COMMIT', 'ROLLBACK', 'SAVEPOINT', 'RELEASE'].includes(command)) return 'other';
  }
  return 'other';
}
export function instrumentDatabase(db: DatabaseSync, observe: (value: Observation) => void) {
  const originalPrepare = db.prepare;
  const originalExec = db.exec;
  let stopped = false;
  const emit = (kind: OperationKind, milliseconds: number, error?: unknown) => {
    if (stopped || excluded.getStore()) return;
    const code = (error as { errcode?: number } | undefined)?.errcode;
    try {
      observe({
        kind,
        milliseconds,
        failed: error !== undefined,
        busy: typeof code === 'number' && [5, 6].includes(code & 255),
      });
    } catch {
      /* Monitoring must never change a database operation's outcome. */
    }
  };
  function measured<T>(kind: OperationKind, work: () => T): T {
    if (stopped || excluded.getStore()) return work();
    const start = performance.now();
    try {
      const result = work();
      emit(kind, performance.now() - start);
      return result;
    } catch (error) {
      emit(kind, performance.now() - start, error);
      throw error;
    }
  }
  db.prepare = function (sql: string): StatementSync {
    let statement: StatementSync;
    const kind = operationKind(sql);
    try {
      statement = originalPrepare.call(db, sql);
    } catch (error) {
      emit('other', 0, error);
      throw error;
    }
    for (const method of ['get', 'all', 'run'] as const) {
      const original = statement[method].bind(statement);
      Object.defineProperty(statement, method, {
        value: (...args: Parameters<StatementSync['run']>) => measured(kind, () => original(...args)),
        configurable: true,
      });
    }
    const originalIterate = statement.iterate.bind(statement);
    Object.defineProperty(statement, 'iterate', {
      value: (...args: Parameters<StatementSync['iterate']>) => {
        if (stopped || excluded.getStore()) return originalIterate(...args);
        const start = performance.now();
        let milliseconds = 0;
        let done = false;
        let iterator: ReturnType<StatementSync['iterate']>;
        try {
          iterator = originalIterate(...args);
        } catch (error) {
          emit(kind, performance.now() - start, error);
          throw error;
        }
        milliseconds += performance.now() - start;
        const finish = (error?: unknown) => {
          if (!done) {
            done = true;
            emit(kind, milliseconds, error);
          }
        };
        return {
          [Symbol.iterator]() {
            return this;
          },
          next() {
            const start = performance.now();
            try {
              const result = iterator.next();
              milliseconds += performance.now() - start;
              if (result.done) finish();
              return result;
            } catch (error) {
              milliseconds += performance.now() - start;
              finish(error);
              throw error;
            }
          },
          return() {
            const start = performance.now();
            try {
              return iterator.return?.() ?? { done: true, value: undefined };
            } finally {
              milliseconds += performance.now() - start;
              finish();
            }
          },
        };
      },
      configurable: true,
    });
    return statement;
  };
  db.exec = function (sql: string) {
    return measured('other', () => originalExec.call(db, sql));
  };
  return () => {
    stopped = true;
    db.prepare = originalPrepare;
    db.exec = originalExec;
  };
}

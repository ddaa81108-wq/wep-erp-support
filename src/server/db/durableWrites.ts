import type { AppDatabase } from './database.ts';
import { inImmediateTransaction } from './database.ts';
import { HttpError } from '../http/errors.ts';

type Job = { work: () => unknown; resolve: (value: unknown) => void; reject: (error: unknown) => void };
type Outcome = { job: Job; ok: true; value: unknown } | { job: Job; ok: false; error: unknown };
const MAX_BATCH = 16;
const MAX_PENDING = 1024;
const WINDOW_MS = 2;

/** Synchronous financial work only. Savepoints isolate operations; a shared FULL
 * COMMIT is completed before any result is released or any route publishes events.
 * No locks/durability pragmas are relaxed and no operation is acknowledged early. */
class DurableWriteQueue {
  private pending: Job[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private database: AppDatabase;
  constructor(database: AppDatabase) {
    this.database = database;
  }

  run<T>(work: () => T): Promise<T> {
    if (this.pending.length >= MAX_PENDING)
      return Promise.reject(
        new HttpError(
          503,
          'FINANCIAL_QUEUE_BUSY',
          'الخادم مشغول. لم تُعتمد العملية؛ أعد المحاولة بنفس الطلب.',
        ),
      );
    return new Promise<T>((resolve, reject) => {
      this.pending.push({ work, resolve: (value) => resolve(value as T), reject });
      this.schedule();
    });
  }
  private schedule() {
    if (!this.timer && this.pending.length) this.timer = setTimeout(() => this.flush(), WINDOW_MS);
  }
  private flush() {
    this.timer = undefined;
    const batch = this.pending.splice(0, MAX_BATCH),
      outcomes: Outcome[] = [];
    const noWrites = Symbol('no successful operations');
    try {
      // Never release an acknowledgement from an unrelated, still-open transaction.
      if (this.database.isTransaction) throw new Error('Cannot batch writes inside an external transaction.');
      inImmediateTransaction(this.database, () => {
        for (const job of batch) {
          try {
            const value = inImmediateTransaction(this.database, () => {
              if (Object.prototype.toString.call(job.work) === '[object AsyncFunction]')
                throw new TypeError('Durable write callbacks must be synchronous.');
              const result = job.work();
              if (
                result !== null &&
                (typeof result === 'object' || typeof result === 'function') &&
                'then' in result
              )
                throw new TypeError('Durable write callbacks must be synchronous.');
              return result;
            });
            outcomes.push({ job, ok: true, value });
          } catch (error) {
            outcomes.push({ job, ok: false, error });
          }
        }
        if (!outcomes.some((outcome) => outcome.ok)) throw noWrites;
      });
      for (const outcome of outcomes) {
        if (outcome.ok) outcome.job.resolve(outcome.value);
        else outcome.job.reject(outcome.error);
      }
    } catch (error) {
      if (error === noWrites) {
        for (const outcome of outcomes) if (!outcome.ok) outcome.job.reject(outcome.error);
      } else for (const job of batch) job.reject(error);
    } finally {
      this.schedule();
    }
  }
}

const queues = new WeakMap<AppDatabase, DurableWriteQueue>();
export function durableWrite<T>(database: AppDatabase, work: () => T): Promise<T> {
  let queue = queues.get(database);
  if (!queue) {
    queue = new DurableWriteQueue(database);
    queues.set(database, queue);
  }
  return queue.run(work);
}

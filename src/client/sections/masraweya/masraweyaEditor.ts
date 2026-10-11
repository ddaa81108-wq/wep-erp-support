import type { MasraweyaDay } from '../../apiTypes.ts';
import { blankMasraweyaRows, englishInteger, type MasraweyaEntryDraft } from './masraweyaModel.ts';

type SaveInput = {
  businessDate: string;
  expectedVersion: number;
  previousValueUnits: number;
  purchasesUnits: number;
  entries: Array<{ valueUnits: number; commissionUnits: number }>;
};
type Transport = {
  load: (date?: string) => Promise<MasraweyaDay>;
  save: (input: SaveInput) => Promise<MasraweyaDay>;
};
type State = {
  day: MasraweyaDay | null;
  rows: MasraweyaEntryDraft[];
  previous: string;
  purchases: string;
  dirty: boolean;
  busy: boolean;
  loading: boolean;
  error: string;
};

/** One in-flight write, immutable request snapshots, and no replacement of newer typing. */
export class MasraweyaEditor {
  private transport: Transport;
  private listeners = new Set<() => void>();
  private revision = 0;
  private loadSequence = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private flight: Promise<boolean> | null = null;
  private invalidInput = false;
  private state: State = {
    day: null,
    rows: blankMasraweyaRows(),
    previous: '0',
    purchases: '0',
    dirty: false,
    busy: false,
    loading: false,
    error: '',
  };
  constructor(transport: Transport) {
    this.transport = transport;
  }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<State>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  private hydrate(day: MasraweyaDay) {
    const rows = blankMasraweyaRows(Math.max(4, ...day.entries.map((entry) => entry.sequence)));
    for (const entry of day.entries)
      rows[entry.sequence - 1] = {
        value: String(entry.valueUnits),
        commission: String(entry.commissionUnits),
      };
    this.publish({
      day,
      rows,
      previous: String(day.previousValueUnits),
      purchases: String(day.purchasesUnits),
      dirty: false,
      error: '',
    });
  }
  async load(date?: string) {
    const sequence = ++this.loadSequence;
    this.publish({ loading: true, error: '' });
    try {
      const day = await this.transport.load(date);
      if (sequence === this.loadSequence) this.hydrate(day);
    } catch (error) {
      if (sequence === this.loadSequence)
        this.publish({ error: error instanceof Error ? error.message : 'تعذر تحميل اليوم.' });
    } finally {
      if (sequence === this.loadSequence) this.publish({ loading: false });
    }
  }
  edit(field: 'previous' | 'purchases', value: string) {
    const cleaned =
      field === 'previous' && value.startsWith('-') ? `-${englishInteger(value)}` : englishInteger(value);
    this.changed({ [field]: cleaned });
  }
  editRow(index: number, field: keyof MasraweyaEntryDraft, value: string) {
    this.changed({
      rows: this.state.rows.map((row, i) => (i === index ? { ...row, [field]: englishInteger(value) } : row)),
    });
  }
  append() {
    if (this.state.rows.length < 500)
      this.publish({ rows: [...this.state.rows, { value: '', commission: '' }] });
  }
  private changed(patch: Partial<State>) {
    this.revision++;
    this.publish({ ...patch, dirty: true, ...(this.invalidInput ? { error: '' } : {}) });
    this.invalidInput = false;
    clearTimeout(this.timer);
    // A failed request requires an explicit retry; never hammer a conflict.
    if (!this.state.error)
      this.timer = setTimeout(() => {
        void this.flush();
      }, 600);
  }
  flush = (): Promise<boolean> => {
    clearTimeout(this.timer);
    if (this.flight) return this.flight;
    this.flight = this.drain().finally(() => {
      this.flight = null;
    });
    return this.flight;
  };
  private async drain() {
    while (this.state.dirty && this.state.day) {
      const { day, rows, previous, purchases } = this.state;
      const revision = this.revision;
      this.publish({ busy: true, error: '' });
      try {
        const numeric = (value: string) => {
          const number = Number(value || 0);
          if (!Number.isSafeInteger(number)) {
            this.invalidInput = true;
            throw new Error('أكمل كتابة قيمة صحيحة في النطاق المسموح ليتم حفظها.');
          }
          return number;
        };
        const saved = await this.transport.save({
          businessDate: day.businessDate,
          expectedVersion: day.version,
          previousValueUnits: numeric(previous),
          purchasesUnits: numeric(purchases),
          entries: rows.map((row) => ({
            valueUnits: numeric(row.value),
            commissionUnits: numeric(row.commission),
          })),
        });
        // Update the version but keep the user's rows, caret and any newer edits.
        this.publish({ day: saved, dirty: revision !== this.revision });
      } catch (error) {
        this.publish({
          busy: false,
          error: error instanceof Error ? error.message : 'تعذر الحفظ؛ مسودتك باقية.',
        });
        return false;
      }
    }
    this.publish({ busy: false });
    return true;
  }
  async changeDate(date: string) {
    if (this.state.loading) return;
    this.publish({ loading: true });
    if (!(await this.flush())) {
      this.publish({ loading: false });
      return;
    }
    await this.load(date);
  }
  async refresh(followToday = false) {
    if (!this.state.day || this.state.loading || this.state.busy || this.state.dirty) return;
    const revision = this.revision;
    const date = this.state.day.businessDate;
    try {
      const next = await this.transport.load(followToday ? undefined : date);
      if (
        this.revision === revision &&
        !this.state.dirty &&
        !this.state.busy &&
        !this.state.loading &&
        this.state.day?.businessDate === date
      ) {
        if (next.version !== this.state.day.version || next.businessDate !== date) this.hydrate(next);
        else this.publish({ day: next });
      }
    } catch {
      /* Keep saved data visible; writes report their own errors. */
    }
  }
  dispose() {
    clearTimeout(this.timer);
    ++this.loadSequence;
  }
}

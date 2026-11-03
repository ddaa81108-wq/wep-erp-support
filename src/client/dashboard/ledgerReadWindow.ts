import type { Ledger } from '../api.ts';
import { uiText } from '../i18n/language.ts';
import { prependOlderLedgerPage } from './debtAccountState.ts';

export function oldestLedgerSequence(ledger: Ledger | null) {
  return ledger?.items.length ? Math.min(...ledger.items.map((item) => item.sequence)) : undefined;
}

/** Read only the visible history range, and never combine different revisions. */
export async function readLedgerWindow(
  readPage: (id: string, before?: string | null) => Promise<Ledger>,
  customerId: string,
  oldestSequence?: number,
  firstPage?: Ledger,
): Promise<Ledger> {
  const changed = () => new Error(uiText('تغيّر السجل أثناء تحديثه. ستُعاد المزامنة دون تكرار أي معاملة.'));
  for (let attempt = 0; attempt < 3; attempt++) {
    let result = attempt === 0 && firstPage ? firstPage : await readPage(customerId);
    if (result.customer.id !== customerId) throw changed();
    const version = result.customer.version;
    const cursors = new Set<string>();
    let restart = false;
    while (
      result.nextCursor &&
      oldestSequence !== undefined &&
      (oldestLedgerSequence(result) ?? Infinity) > oldestSequence
    ) {
      const cursor = result.nextCursor;
      if (cursors.has(cursor)) throw changed();
      cursors.add(cursor);
      const older = await readPage(customerId, cursor);
      if (older.customer.id !== customerId) throw changed();
      if (older.customer.version !== version) {
        restart = true;
        break;
      }
      if (!older.items.length && older.nextCursor) throw changed();
      result = prependOlderLedgerPage(result, older)!;
    }
    if (!restart) return result;
  }
  throw changed();
}

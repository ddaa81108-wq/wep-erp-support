import { useEffect, useState } from 'react';
import { api, type CollectionAssignment, type CollectionWorkspace } from '../../api.ts';
import { uiText } from '../../i18n/language.ts';
import { collectionError } from '../../sections/collections/useCollectionsDashboard.ts';
import { CollectionReceiptRows } from './CollectionReceiptRows.tsx';

export function CollectionAssignmentHistory({
  assignment,
  revision,
  busy,
  run,
}: {
  assignment: CollectionAssignment;
  revision: object;
  busy: boolean;
  run: (id: string, action: () => Promise<unknown>) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false),
    [page, setPage] = useState(1);
  const [result, setResult] = useState<CollectionWorkspace | null>(null),
    [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void api
      .collectionWorkspace(
        { batchId: assignment.batchId, assignmentId: assignment.id, state: 'all', page },
        controller.signal,
      )
      .then((value) => {
        if (!controller.signal.aborted) setResult(value);
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(collectionError(reason));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [assignment.batchId, assignment.id, page, open, revision]);
  return (
    <details className="board-card-history" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{uiText('تفاصيل الاستلامات')}</summary>
      {open && (
        <>
          {error && <p role="alert">{error}</p>}
          {loading && <p role="status">{uiText('جارٍ التحميل…')}</p>}
          {!loading && !error && result?.items.length === 0 && (
            <p>{uiText('لم يسجل الموظف استلامًا بعد.')}</p>
          )}
          {result && <CollectionReceiptRows items={result.items} busy={busy || loading} run={run} />}
          {result && (page > 1 || result.hasMore) && (
            <div className="board-pagination">
              <button disabled={page === 1 || loading} onClick={() => setPage((value) => value - 1)}>
                {uiText('السابق')}
              </button>
              <span>{page}</span>
              <button disabled={!result.hasMore || loading} onClick={() => setPage((value) => value + 1)}>
                {uiText('التالي')}
              </button>
            </div>
          )}
        </>
      )}
    </details>
  );
}

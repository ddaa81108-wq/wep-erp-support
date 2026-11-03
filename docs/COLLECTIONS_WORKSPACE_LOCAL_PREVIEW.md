# Administrative collection workspace — local preview

Prepared 2026-11-02. This change is a local review candidate, not a production deployment.

## Behavior

- Four views: pending review, awaiting cash handover, assigned cards, and outstanding cash from closed batches.
- Batch and employee ID define the financial summary. Name search and tabs filter visible records without changing these totals. Employees with identical display names remain separate accounts.
- Approved amount = cash received + cash outstanding within the selected batch/employee. Pending linked and unlinked receipt counts are included separately from approved money.
- Previous cash is displayed separately; cancelled assignments in an open batch remain accessible in the current cash view.
- Cards retain existing financial status colors and show their current account balance. Receipt history is expanded on demand, including multiple independent partial collections.
- Review and cash controls call existing mutation APIs. Closing applies to the whole batch and preserves existing pending-review blocks and exceptional-close safeguards.
- Financial posting logic is unchanged. No migration is introduced. The subsequent employee preview is described below.

## Read API

`GET /api/collections/workspace` is administrator-only and organization-scoped.

Parameters: `batchId`, optional `employeeId`, `state=review|cash|all`, `q`, `page` (positive integer), and `assignmentId` for card details. Pages contain up to 60 records with `totalItems` and `hasMore`.

The response includes `summary`, employee identities, and receipt rows. Summary aggregation covers the complete batch/employee data, independently of page, search, or tab; it does not use the older dashboard's capped receipt arrays.

Explicit `state=all&export=1` returns every approved row for the batch PDF, without the old 200-row cap. PDF title and control specify that the export covers the batch.

## Validation

- Build, TypeScript and ESLint pass.
- All 225 Node tests pass, including the complete-data summary, organization isolation, employee rejection, pagination, read-only behavior, and duplicate employee names.
- `npm run test:collection-board-ui`: 96 screenshots/states across six widths (360–1920), two themes, two shell appearances and four tabs. Checks viewport overflow, control bounds, unchanged totals, dense cards, search, employee scope, four partial collections, pagination, read failure/retry, cash receipt without reposting, approval reconciliation and blocking closure with pending reviews.
- Existing collection presentation, exceptional closure, unlinked currency and idempotency browser tests pass after updating selectors for the new administrative layout. Employee behavior remains covered.
- Synthetic fixture: 200 assigned cards, more than 200 receipts, four staff members, long names, large values, repeated partials and outstanding prior-batch cash.
- Screenshots and JSON results are generated under ignored `artifacts/collection-board/`; preview runtime scripts and logs are under ignored `var/`.

The running preview uses a disposable in-memory database bound to loopback. Its local preview helper/session is outside application source and the production build. Synthetic values are not production reconciliation evidence.

## Employee preview, also local only

The employee view adds three tabs (assigned cards, own receipt history, cash), a name/phone search, and a three-item summary. Cash outstanding includes previous batches; previous cash is listed separately from current receipts. Search never changes summary amounts.

Expanded card histories load their own paginated receipts on demand. A new read-only `GET /api/collections/mine` endpoint always binds the collector to the authenticated employee ID and organization. Caller-supplied employee IDs cannot change this scope, export cannot bypass pagination, and the administrative workspace endpoint remains forbidden to employees.

Payment submission, request recovery/idempotency, full-payment guards and repeated partial-payment rules remain intact. Approval and cash-confirmation controls are absent from the employee view. Search/tab navigation checks unsaved forms before hiding them.

Run `npm run test:employee-collection-board-ui` for 60 employee visual states across five widths, both themes, both appearances and all three tabs, plus repeated partials, permission boundaries, search, paging and unsaved-form navigation. Generated screenshots are under ignored `artifacts/employee-collection-board/`.

## Correcting an approved receipt before cash handover

Administrators can cancel one approved linked/unlinked receipt before its cash has been confirmed received. A reason and the expected posting reference are required. The operation uses the existing ledger reversal command and one database transaction to reverse the intact original posting, mark the receipt rejected, retain its original posting reference, record the cancellation evidence, and remove its outstanding cash liability. It does not delete or reverse other receipts or later account activity.

No migration is needed: a rejected receipt with a retained approved posting reference represents a cancelled approval. Read APIs expose `approvalCancelled`, and complete histories show the cancellation and reason to the administrator and employee. Original approval actor/time and notes are preserved in audit evidence; the ledger retains the reversed posting.

## Pre-approval rejection keeps the assignment

Rejecting a pending linked receipt now rejects that receipt only. The existing customer/company assignment remains active for the same employee, even when no other receipts are pending. The employee can submit a corrected receipt with a new requestId without asking for reassignment. Posted balances, earlier approved receipts and outstanding cash remain unchanged. Only the explicit administrator unassignment action (or batch closure) ends the assignment. Previously cancelled assignments are not automatically reactivated; historical migration 46 remains unchanged.

## Compact cards retain assigned debt after settlement

Admin and employee cards display `assignedBalanceUnits` (the fixed debt when this assignment was created) beside `balanceUnits` (the current signed account balance). This is not the account's opening balance or the amount of its latest receipt. A later payment, rejection or account edit never overwrites the assignment snapshot; a new assignment records its own current debt. Expanded receipt history remains optional.

Schema 54 adds the nullable `debt_assignments.assigned_balance_units` display snapshot. For legacy assignments, backfill only reconstructs the value when the available ledger shows no unrelated entries/edits or cycle changes since assignment. Unknown historical values remain null and are displayed as “غير مسجلة”; zero is never substituted for an unknown amount. Financial transactions, balances and receipt ownership are unchanged. Rejected active cards now have an explicit opaque background and readable text in both themes.

POST `/api/collections/submissions/:id/cancel-approval` and `/api/collections/unlinked-receipts/:id/cancel-approval` accept `requestId`, `reason`, and `expectedTransactionId`. Only administrators can call these routes. Cash already received, a changed/corrected original posting, a different currency or an inactive posting cycle blocks the operation. Exact retries replay the result, while a competing cash confirmation and cancellation can only yield one successful transition.

`collection-approval-cancellation.test.ts` tests accounting, idempotency, permissions, stale/changed data, atomic rollback, both unlinked posting directions, and an HTTP race. `npm run test:collection-approval-cancellation-ui` tests the reason dialog on desktop/phone, employee cancellation evidence, a lost accepted response, and a stale dialog after cash receipt. Production deployment remains outside this local preview.

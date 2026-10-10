export const NOTIFICATION_REALTIME_TOPICS = [
  'customer.changed',
  'customer.ledger.changed',
  'company.changed',
  'company.ledger.changed',
  'libyan-deposit.changed',
  'libyan-deposit.ledger.changed',
  'egyptian-deposit.changed',
  'egyptian-deposit.ledger.changed',
  'collection.changed',
  'masraweya.changed',
  'purchases.changed',
  'treasury.changed',
] as const;

export const NOTIFICATION_SAFETY_POLL_INTERVAL_MS = 4_000;

export type CollectionCardState = {
  id: string;
  assignedAt: string;
  balanceUnits: number;
  latestMode: 'full' | 'partial' | null;
  latestStatus: 'pending' | 'approved' | 'rejected' | null;
  latestSubmissionAt: string | null;
  latestDecisionAt?: string | null;
  latestCashReceivedAt: string | null;
  externalFinancialUpdatedAt: string;
  hasPending: number;
  cashOutstandingCount?: number;
};

export function hasAdministrativeMovement(card: CollectionCardState) {
  const lastCollectionAction = card.latestStatus === 'rejected' && card.latestDecisionAt
    ? card.latestDecisionAt : card.latestSubmissionAt;
  return card.externalFinancialUpdatedAt > card.assignedAt
    && (!lastCollectionAction || card.externalFinancialUpdatedAt > lastCollectionAction);
}

export function collectionCardTone(card: CollectionCardState) {
  if (card.latestStatus === 'rejected' && !card.hasPending && !hasAdministrativeMovement(card)) return 'collection-rejected';
  if (card.balanceUnits < 0) return 'collection-green';
  if (card.balanceUnits === 0) {
    return card.latestCashReceivedAt && card.latestCashReceivedAt >= card.externalFinancialUpdatedAt
      && !card.hasPending && !card.cashOutstandingCount
      ? 'collection-red' : 'zero-collection-card';
  }
  if (hasAdministrativeMovement(card)) return 'collection-base';
  return card.latestMode === 'partial' ? 'collection-yellow' : 'collection-base';
}

function rank(card: CollectionCardState) {
  const tone = collectionCardTone(card);
  if (tone === 'collection-rejected') return 5;
  if (tone === 'collection-red') return 4;
  if (card.balanceUnits === 0) return 3;
  if (hasAdministrativeMovement(card)) return 0;
  if (tone === 'collection-base') return 0;
  if (tone === 'collection-yellow') return 1;
  if (tone === 'collection-green') return 2;
  return 3;
}

export function compareCollectionCards(a: CollectionCardState, b: CollectionCardState) {
  const priority = rank(a) - rank(b);
  if (priority) return priority;
  const time = (card: CollectionCardState) => rank(card) === 0
    ? (card.externalFinancialUpdatedAt > card.assignedAt ? card.externalFinancialUpdatedAt : card.assignedAt)
    : card.assignedAt;
  // Employee submissions and cash handover never become a recency signal.
  return time(b).localeCompare(time(a)) || b.assignedAt.localeCompare(a.assignedAt) || b.id.localeCompare(a.id);
}

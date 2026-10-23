export type PendingCollectionRequest = {
  assignmentId: string;
  requestId: string;
  mode: 'full' | 'partial';
  amountUnits: number;
};

export const pendingCollectionKey = (userId: string) => `abdo:pending-collection-submissions:${userId}`;

export function readPendingCollections(storage: Pick<Storage, 'getItem'>, userId: string): PendingCollectionRequest[] {
  const value: unknown = JSON.parse(storage.getItem(pendingCollectionKey(userId)) ?? '[]');
  if (!Array.isArray(value) || value.some(item => !item || typeof item.assignmentId !== 'string'
    || typeof item.requestId !== 'string' || item.requestId.length < 8
    || !['full', 'partial'].includes(item.mode) || !Number.isSafeInteger(item.amountUnits) || item.amountUnits <= 0))
    throw new Error('Invalid pending collection journal');
  return value;
}

export function writePendingCollections(storage: Pick<Storage, 'setItem'>, userId: string, requests: PendingCollectionRequest[]) {
  storage.setItem(pendingCollectionKey(userId), JSON.stringify(requests));
}

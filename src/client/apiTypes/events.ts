export type LiveChange = {
  sequence: number;
  topic: string;
  aggregateId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
};

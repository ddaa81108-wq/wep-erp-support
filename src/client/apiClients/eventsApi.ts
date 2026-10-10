import { request } from '../apiTransport.ts';
import type { LiveChange } from '../apiTypes.ts';

export const eventsApi = {
  eventChanges: (after: number) =>
    request<{ fullResync: boolean; latest: number; events: LiveChange[] }>(
      `/api/event-changes?after=${after}`,
    ),
};

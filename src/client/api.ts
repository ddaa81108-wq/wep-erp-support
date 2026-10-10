import { administrationApi } from './apiClients/administrationApi.ts';
import { authApi } from './apiClients/authApi.ts';
import { collectionsApi } from './apiClients/collectionsApi.ts';
import { debtsApi } from './apiClients/debtsApi.ts';
import { depositsApi } from './apiClients/depositsApi.ts';
import { eventsApi } from './apiClients/eventsApi.ts';
import { masraweyaApi } from './apiClients/masraweyaApi.ts';
import { purchasesApi } from './apiClients/purchasesApi.ts';
import { treasuryApi } from './apiClients/treasuryApi.ts';
import { reportsApi } from './apiClients/reportsApi.ts';

export { API_VERSION, ApiError } from './apiTransport.ts';
export type * from './apiTypes.ts';

export const api = {
  ...eventsApi,
  ...authApi,
  ...debtsApi,
  ...depositsApi,
  ...masraweyaApi,
  ...purchasesApi,
  ...collectionsApi,
  ...treasuryApi,
  ...reportsApi,
  ...administrationApi,
};

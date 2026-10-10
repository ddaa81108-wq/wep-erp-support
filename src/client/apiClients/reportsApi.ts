import { request } from '../apiTransport.ts';
import type { ReportsDashboard } from '../apiTypes.ts';

export const reportsApi = {
  reports: (limit = 30) => request<ReportsDashboard>(`/api/reports?limit=${limit}`),
};

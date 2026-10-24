import { request } from '../apiTransport.ts';
import type { ReportsDashboard } from '../apiTypes.ts';
import type { ReportActivity, ReportActivityGroup, ReportOverview, ReportSourceDetails, ReportSourceKey } from '../../shared/reportOverview.ts';

export const reportsApi = {
  reportOverview: () => request<ReportOverview>('/api/reports/overview'),
  reportSourceDetails: (group: ReportSourceKey, page = 1) => request<ReportSourceDetails>(`/api/reports/sources?group=${group}&page=${page}`),
  reportActivity: (group: ReportActivityGroup = 'all', page = 1) => request<ReportActivity>(`/api/reports/activity?group=${group}&page=${page}`),
  reports: (limit = 30) => request<ReportsDashboard>(`/api/reports?limit=${limit}`),
};

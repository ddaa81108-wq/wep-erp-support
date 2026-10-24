import { request } from '../apiTransport.ts';
import type { ReportsDashboard } from '../apiTypes.ts';
import type { ReportActivity, ReportActivityGroup, ReportOverview, ReportSourceDetails, ReportSourceKey } from '../../shared/reportOverview.ts';
import type { ReportClosingHistory, ReportClosingJournal } from '../../shared/reportOverview.ts';

export const reportsApi = {
  reportClosingHistory: (before: string) => request<ReportClosingHistory>(`/api/reports/closing-history?before=${encodeURIComponent(before)}`),
  reportClosingJournal: (day: string, page = 1) => request<ReportClosingJournal>(`/api/reports/closing-journal?day=${encodeURIComponent(day)}&page=${page}`),
  reportOverview: () => request<ReportOverview>('/api/reports/overview'),
  reportSourceDetails: (group: ReportSourceKey, page = 1) => request<ReportSourceDetails>(`/api/reports/sources?group=${group}&page=${page}`),
  reportActivity: (group: ReportActivityGroup = 'all', page = 1) => request<ReportActivity>(`/api/reports/activity?group=${group}&page=${page}`),
  reports: (limit = 30) => request<ReportsDashboard>(`/api/reports?limit=${limit}`),
};

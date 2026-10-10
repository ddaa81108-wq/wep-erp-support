import { rememberCsrf, request } from '../apiTransport.ts';
import type { User } from '../apiTypes.ts';

export const authApi = {
  setupStatus: () => request<{ setupRequired: boolean }>('/api/setup/status'),
  googleAuthStatus: () =>
    request<{ configured: boolean; registrationRequiresApproval: boolean }>('/api/auth/google/status'),
  setupAdmin: (body: { username: string; displayName: string; password: string }) =>
    request<{ user: User }>('/api/setup/admin', { method: 'POST', body: JSON.stringify(body) }),
  login: async (username: string, password: string) => {
    const result = await request<{ user: User; csrfToken: string; expiresAt: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    rememberCsrf(result.csrfToken);
    return result;
  },
  resume: async () => {
    const me = await request<{ user: User }>('/api/me');
    const csrf = await request<{ csrfToken: string }>('/api/auth/csrf');
    rememberCsrf(csrf.csrfToken);
    return me;
  },
  logout: async () => {
    const result = await request<{ loggedOut: boolean }>('/api/auth/logout', { method: 'POST' });
    rememberCsrf('');
    return result;
  },
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ changed: boolean }>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
};

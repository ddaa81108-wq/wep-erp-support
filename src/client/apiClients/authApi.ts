import { rememberCsrf, request } from '../apiTransport.ts';
import type { User } from '../apiTypes.ts';
import { resetRealtimeSession } from '../realtime/sharedTransport.ts';

export const authApi = {
  setupStatus: () => request<{ setupRequired: boolean }>('/api/setup/status'),
  googleAuthStatus: () =>
    request<{ configured: boolean; registrationRequiresApproval: boolean }>('/api/auth/google/status'),
  setupAdmin: (body: { username: string; displayName: string; password: string }) =>
    request<{ user: User }>('/api/setup/admin', { method: 'POST', body: JSON.stringify(body) }),
  login: async (username: string, password: string) => {
    const result = await request<{ user: User; csrfToken: string; expiresAt: string; liveSequence?:number }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    rememberCsrf(result.csrfToken);
    resetRealtimeSession(result.liveSequence);
    return result;
  },
  verifyMfa: async (code: string) => {
    const result = await request<{ user: User; csrfToken: string;liveSequence?:number }>('/api/auth/mfa/verify', { method: 'POST', body: JSON.stringify({ code }) });
    rememberCsrf(result.csrfToken);resetRealtimeSession(result.liveSequence); return result;
  },
  resume: async () => {
    const me = await request<{ user: User;liveSequence?:number }>('/api/me');
    const csrf = await request<{ csrfToken: string }>('/api/auth/csrf');
    rememberCsrf(csrf.csrfToken);
    resetRealtimeSession(me.liveSequence);
    return me;
  },
  logout: async () => {
    const result = await request<{ loggedOut: boolean }>('/api/auth/logout', { method: 'POST' });
    rememberCsrf('');
    resetRealtimeSession();
    return result;
  },
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ changed: boolean }>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
};

import { resolve } from 'node:path';
import { DEFAULT_ORGANIZATION_ID } from './domain/tenancy.ts';

export const API_VERSION = '1';
export const SCHEMA_VERSION = '43';
export const UI_VERSION = '0.14.0-workflow-safety';

const intFromEnv = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
};

const urlsFromEnv = () => {
  const urls = process.env.ABDO_INTERNET_PROBE_URLS?.split(',')
    .map((url) => url.trim())
    .filter(Boolean);
  return urls?.length
    ? urls
    : ['http://www.msftconnecttest.com/connecttest.txt', 'https://www.google.com/generate_204'];
};

export type ServerConfig = {
  host: string;
  port: number;
  databasePath: string;
  sessionHours: number;
  secureCookie: boolean;
  internetRequired: boolean;
  internetProbeUrls: string[];
  internetProbeTimeoutMs: number;
  internetProbeCacheMs: number;
  googleClientId?: string;
  googleClientSecret?: string;
  googleRedirectUri?: string;
  googleRegistrationOrganizationId?: string;
  setupToken?: string;
};

export function loadConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    host: overrides.host ?? process.env.ABDO_HOST ?? '127.0.0.1',
    port: overrides.port ?? intFromEnv('ABDO_PORT', 4310),
    databasePath: overrides.databasePath ?? resolve(process.env.ABDO_DB_PATH ?? './var/abdo-erp.sqlite'),
    sessionHours: overrides.sessionHours ?? intFromEnv('ABDO_SESSION_HOURS', 12),
    secureCookie: overrides.secureCookie ?? process.env.ABDO_COOKIE_SECURE === 'true',
    internetRequired: overrides.internetRequired ?? true,
    internetProbeUrls: overrides.internetProbeUrls ?? urlsFromEnv(),
    internetProbeTimeoutMs:
      overrides.internetProbeTimeoutMs ?? intFromEnv('ABDO_INTERNET_PROBE_TIMEOUT_MS', 5_000),
    internetProbeCacheMs: overrides.internetProbeCacheMs ?? intFromEnv('ABDO_INTERNET_PROBE_CACHE_MS', 2_000),
    googleClientId: overrides.googleClientId ?? process.env.ABDO_GOOGLE_CLIENT_ID ?? '',
    googleClientSecret: overrides.googleClientSecret ?? process.env.ABDO_GOOGLE_CLIENT_SECRET ?? '',
    googleRedirectUri:
      overrides.googleRedirectUri ??
      process.env.ABDO_GOOGLE_REDIRECT_URI ??
      'https://localhost/api/auth/google/callback',
    googleRegistrationOrganizationId:
      overrides.googleRegistrationOrganizationId ??
      process.env.ABDO_GOOGLE_REGISTRATION_ORGANIZATION_ID ??
      DEFAULT_ORGANIZATION_ID,
    setupToken: overrides.setupToken ?? process.env.ABDO_SETUP_TOKEN ?? '',
  };
}

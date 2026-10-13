import { APPLICATION_VERSION } from './version.ts';
declare const __BUILD_INFO__: { version: string; commit: string | null; builtAt: string | null; dirty: boolean };
export const BUILD_INFO = typeof __BUILD_INFO__ === 'undefined'
  ? { version: APPLICATION_VERSION, commit: null, builtAt: null, dirty: false }
  : __BUILD_INFO__;

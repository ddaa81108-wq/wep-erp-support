import { join } from 'node:path';

export function windowsPowerShellExecutable(environment) {
  const windows = environment.SystemRoot || environment.WINDIR || 'C:\\Windows';
  return join(windows, 'System32/WindowsPowerShell/v1.0/powershell.exe');
}

export function windowsPowerShellEnvironment(environment) {
  // Do not inherit PowerShell 7's module path into Windows PowerShell 5.1.
  const clean = Object.fromEntries(
    Object.entries(environment).filter(([key]) => key.toLowerCase() !== 'psmodulepath'),
  );
  const windows = environment.SystemRoot || environment.WINDIR || 'C:\\Windows';
  const programs = environment.ProgramFiles || 'C:\\Program Files';
  clean.PSModulePath = [
    join(windows, 'System32/WindowsPowerShell/v1.0/Modules'),
    join(programs, 'WindowsPowerShell/Modules'),
  ].join(';');
  return clean;
}

import { routePermanentAccounts, type PermanentAccountRouteContext } from './permanentAccountRoutes.ts';

export const routeCompanies = (context: PermanentAccountRouteContext) =>
  routePermanentAccounts(context, {
    basePath: '/api/companies',
    readPermission: 'companies.read',
    writePermission: 'companies.write',
    kind: 'company',
  });

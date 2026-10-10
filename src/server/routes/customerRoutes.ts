import { routePermanentAccounts, type PermanentAccountRouteContext } from './permanentAccountRoutes.ts';

export const routeCustomers = (context: PermanentAccountRouteContext) =>
  routePermanentAccounts(context, {
    basePath: '/api/customers',
    readPermission: 'debts.read',
    writePermission: 'debts.write',
    kind: 'customer',
  });

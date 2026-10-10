import type { User } from '../../api.ts';
import { AdminCollectionsSection } from '../../admin/collections/AdminCollectionsSection.tsx';
import { EmployeeCollectionsSection } from '../../employee/collections/EmployeeCollectionsSection.tsx';

export function CollectionsSection({ user }: { user: User }) {
  return user.role === 'admin'
    ? <AdminCollectionsSection />
    : <EmployeeCollectionsSection />;
}

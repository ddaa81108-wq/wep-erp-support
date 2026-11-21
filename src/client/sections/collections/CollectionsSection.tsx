import type { User } from '../../api.ts';
import { AdminCollectionsSection } from '../../admin/collections/AdminCollectionsSection.tsx';
import { EmployeeCollectionsSection } from '../../employee/collections/EmployeeCollectionsSection.tsx';
// Keep the original cascade order; Vite waits for this CSS before showing the section.
import '../../styles/collection-board.css';
import '../../styles/employee-collection-board.css';

export function CollectionsSection({ user }: { user: User }) {
  return user.role === 'admin'
    ? <AdminCollectionsSection />
    : <EmployeeCollectionsSection key={user.id} userId={user.id} />;
}

import { X } from 'lucide-react';

export function CollectionRejectedBadge() {
  return <div className="collection-rejected-badge" role="status">
    <X size={38} strokeWidth={3} aria-hidden="true" />
    <strong>تم الرفض</strong>
  </div>;
}

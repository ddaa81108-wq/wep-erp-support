import type { ServerResponse } from 'node:http';
import type { AppDatabase } from './db/database.ts';
import { HttpError } from './http/errors.ts';

export const MAX_EVENT_STREAMS_PER_USER = 8;
export const MAX_EVENT_STREAMS = 256;
const MAX_BUFFERED_BYTES = 256 * 1024;

export type EventViewer = {
  userId: string;
  sessionTokenHash: string;
};

type ResolvedViewer = { userId: string; role: string; organizationId: string; permissions: Set<string> };
type Subscriber = { response: ServerResponse; viewer: EventViewer; keepAlive: NodeJS.Timeout };

const EVENT_PERMISSION_PREFIXES = [
  ['customer.', 'debts.read'],
  ['company.', 'companies.read'],
  ['libyan-deposit.', 'libyan_deposits.read'],
  ['egyptian-deposit.', 'egyptian_deposits.read'],
  ['collection.', 'collections.read'],
  ['masraweya.', 'masraweya.read'],
  ['purchases.', 'purchases.read'],
  ['treasury.', 'treasury.read'],
] as const;

export class EventHub {
  database: AppDatabase;
  subscribers = new Set<Subscriber>();

  constructor(database: AppDatabase) {
    this.database = database;
  }

  attach(response: ServerResponse, after: number, viewer: EventViewer) {
    const resolved = this.resolveViewer(viewer);
    if (!resolved) return false;
    const count = [...this.subscribers].filter(item => item.viewer.userId === viewer.userId).length;
    if (count >= MAX_EVENT_STREAMS_PER_USER || this.subscribers.size >= MAX_EVENT_STREAMS) {
      response.setHeader('Retry-After', '30');
      throw new HttpError(429, 'EVENT_STREAM_LIMIT', 'اتصالات التحديث كثيرة. أغلق التبويبات الزائدة وأعد المحاولة.');
    }
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    response.write(': connected\n\n');

    const bounds = this.database
      .prepare(
        `
      SELECT COALESCE(MIN(sequence), 0) AS minimum,
             COALESCE(MAX(sequence), 0) AS maximum
      FROM event_log WHERE organization_id = ?
    `,
      )
      .get(resolved.organizationId) as { minimum: number; maximum: number };
    if (after > 0 && Number(bounds.minimum) > after + 1) {
      response.write(
        `event: full_resync_required\ndata: ${JSON.stringify({ latest: Number(bounds.maximum) })}\n\n`,
      );
    } else {
      const rows = this.database
        .prepare(
          `
        SELECT sequence, topic, aggregate_id, organization_id, payload_json, created_at
        FROM event_log WHERE organization_id = ? AND sequence > ? ORDER BY sequence ASC LIMIT 500
      `,
        )
        .all(resolved.organizationId, after);
      for (const row of rows) {
        const event = row as Record<string, unknown>;
        const visible = this.visibleEvent(resolved, event);
        if (visible) this.writeRow(response, visible);
      }
    }

    if (response.destroyed || response.writableEnded) return true;
    const subscriber: Subscriber = {
      response,
      viewer,
      keepAlive: setInterval(() => {
        if (!this.resolveViewer(viewer)) {
          response.end();
          return;
        }
        if (response.writableLength > MAX_BUFFERED_BYTES) response.destroy();
        else response.write(': keepalive\n\n');
      }, 25_000),
    };
    this.subscribers.add(subscriber);
    response.on('close', () => {
      clearInterval(subscriber.keepAlive);
      this.subscribers.delete(subscriber);
    });
    return true;
  }

  publish(sequence: number) {
    const row = this.database
      .prepare(
        `
      SELECT sequence, topic, aggregate_id, organization_id, payload_json, created_at
      FROM event_log WHERE sequence = ?
    `,
      )
      .get(sequence) as Record<string, unknown> | undefined;
    if (!row) return;
    for (const subscriber of this.subscribers) {
      const viewer = this.resolveViewer(subscriber.viewer);
      if (!viewer) {
        subscriber.response.end();
      } else if (viewer.organizationId === String(row.organization_id)) {
        const visible = this.visibleEvent(viewer, row);
        if (visible) this.writeRow(subscriber.response, visible);
      }
    }
  }

  changesAfter(after: number, viewer: EventViewer) {
    const resolved = this.resolveViewer(viewer);
    if (!resolved) return null;
    const bounds = this.database
      .prepare(
        `
      SELECT COALESCE(MIN(sequence), 0) AS minimum,
             COALESCE(MAX(sequence), 0) AS maximum
      FROM event_log WHERE organization_id = ?
    `,
      )
      .get(resolved.organizationId) as { minimum: number; maximum: number };
    const latest = Number(bounds.maximum);
    if (after > 0 && Number(bounds.minimum) > after + 1) {
      return { fullResync: true, latest, events: [] };
    }
    const rows = this.database
      .prepare(
        `
      SELECT sequence, topic, aggregate_id, organization_id, payload_json, created_at
      FROM event_log WHERE organization_id = ? AND sequence > ? ORDER BY sequence ASC LIMIT 500
    `,
      )
      .all(resolved.organizationId, after) as Record<string, unknown>[];
    return {
      fullResync: false,
      latest: rows.length > 0 ? Number(rows[rows.length - 1].sequence) : latest,
      events: rows
        .map((row) => this.visibleEvent(resolved, row))
        .filter((row): row is Record<string, unknown> => row !== null)
        .map((row) => ({
          sequence: Number(row.sequence),
          topic: String(row.topic),
          aggregateId: row.aggregate_id ? String(row.aggregate_id) : null,
          payload: JSON.parse(String(row.payload_json)),
          createdAt: String(row.created_at),
        })),
    };
  }

  close() {
    for (const subscriber of this.subscribers) {
      clearInterval(subscriber.keepAlive);
      subscriber.response.end();
    }
    this.subscribers.clear();
  }

  private writeRow(response: ServerResponse, row: Record<string, unknown>) {
    if (response.destroyed || response.writableEnded) return;
    if (response.writableLength > MAX_BUFFERED_BYTES) { response.destroy(); return; }
    response.write(
      `id: ${Number(row.sequence)}\nevent: ${String(row.topic)}\ndata: ${JSON.stringify({
        sequence: Number(row.sequence),
        aggregateId: row.aggregate_id ? String(row.aggregate_id) : null,
        payload: JSON.parse(String(row.payload_json)),
        createdAt: String(row.created_at),
      })}\n\n`,
    );
  }

  private resolveViewer(viewer: EventViewer): ResolvedViewer | null {
    const row = this.database
      .prepare(
        `
      SELECT u.role, u.organization_id FROM sessions s
      JOIN users u ON u.id = s.user_id
      JOIN organizations o ON o.id = u.organization_id
      JOIN branches b ON b.id = u.home_branch_id AND b.organization_id = o.id
      WHERE s.token_hash = ? AND s.user_id = ? AND s.revoked_at IS NULL
        AND s.expires_at > ? AND u.is_active = 1
        AND o.status = 'active' AND b.is_active = 1
    `,
      )
      .get(viewer.sessionTokenHash, viewer.userId, new Date().toISOString()) as
      | {
          role: string;
          organization_id: string;
        }
      | undefined;
    if (!row) return null;
    const permissions = new Set(
      this.database
        .prepare(
          `
      SELECT permission FROM user_permissions WHERE user_id = ? AND allowed = 1
    `,
        )
        .all(viewer.userId)
        .map((item) => String(item.permission)),
    );
    return {
      userId: viewer.userId,
      role: String(row.role),
      organizationId: String(row.organization_id),
      permissions,
    };
  }

  private visibleEvent(viewer: ResolvedViewer, row: Record<string, unknown>): Record<string, unknown> | null {
    const topic = String(row.topic);
    if (this.canReadTopic(viewer, topic, row.aggregate_id)) return row;
    const financial = /^(customer|company|libyan-deposit|egyptian-deposit|collection|purchases|masraweya|treasury)\./.test(topic);
    if (financial && (viewer.permissions.has('treasury.read') || viewer.permissions.has('reports.read'))) {
      // A viewer may read aggregate totals without permission to see source accounts.
      // Signal invalidation only: never reveal account IDs, actors or financial payloads.
      return { ...row, topic: 'financial.summary.changed', aggregate_id: null, payload_json: '{}' };
    }
    return null;
  }

  private canReadTopic(viewer: ResolvedViewer, topic: string, aggregateId: unknown) {
    if (viewer.role === 'admin') return true;
    const mapping = EVENT_PERMISSION_PREFIXES.find(([prefix]) => topic.startsWith(prefix));
    if (mapping && viewer.permissions.has(mapping[1])) return true;
    if (
      (!topic.startsWith('customer.') && !topic.startsWith('company.')) ||
      !viewer.permissions.has('collections.read') ||
      !aggregateId
    )
      return false;
    const sectionKey = topic.startsWith('company.') ? 'company_debts' : 'customer_debts';
    return Boolean(
      this.database
        .prepare(
          `
      SELECT 1 FROM debt_assignments a
      JOIN customers c ON c.id = a.customer_id
      WHERE a.customer_id = ? AND a.assignee_user_id = ? AND a.status = 'active'
        AND c.organization_id = ? AND c.section_key = ?
    `,
        )
        .get(String(aggregateId), viewer.userId, viewer.organizationId, sectionKey),
    );
  }
}

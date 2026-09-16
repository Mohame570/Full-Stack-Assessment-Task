'use client';

import { ChatCircleIcon } from '@phosphor-icons/react/dist/ssr';
import type { TaskActivityEntry } from '@projectflow/shared';
import { Avatar } from '@/components/ui/avatar';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { formatRelativeTime } from '@/lib/format';
import { useTaskActivity } from '../hooks';

/** Plain-history sentences, matching the brief examples. */
function describeActivity(entry: TaskActivityEntry): string {
  const actor = entry.actor.name;
  if (!entry.from && entry.to) {
    return entry.actor.id === entry.to.id
      ? `${actor} assigned themselves`
      : `${actor} assigned ${entry.to.name}`;
  }
  if (entry.from && entry.to) {
    if (entry.from.id === entry.actor.id) {
      return `${actor} changed the assignee from themselves to ${entry.to.name}`;
    }
    if (entry.to.id === entry.actor.id) {
      return `${actor} changed the assignee from ${entry.from.name} to themselves`;
    }
    return `${actor} changed the assignee from ${entry.from.name} to ${entry.to.name}`;
  }
  return `${actor} removed the assignee`;
}

export function TaskActivityTimeline({ taskId }: { taskId: string }) {
  const { data, isPending, isError, error } = useTaskActivity(taskId);

  return (
    <section className="space-y-4" aria-label="Activity">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-foreground">Activity</h2>
        {data ? (
          <span className="rounded-sm bg-surface-strong px-1.5 text-[11px] text-muted-foreground">
            {data.total}
          </span>
        ) : null}
      </div>

      {isPending ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : isError ? (
        <p className="rounded-md border border-danger/30 bg-danger-subtle px-3 py-2 text-[13px] text-danger">
          {error.message}
        </p>
      ) : data.items.length === 0 ? (
        <EmptyState
          icon={ChatCircleIcon}
          title="No activity yet"
          description="Assignee changes will appear here."
        />
      ) : (
        <ul className="space-y-3">
          {data.items.map((entry) => (
            <li key={entry.id} className="flex gap-3">
              <Avatar user={entry.actor} size="md" />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] leading-5 text-muted-foreground">
                  {describeActivity(entry)}
                </p>
                <span className="text-[12px] text-subtle-foreground">
                  {formatRelativeTime(entry.createdAt)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

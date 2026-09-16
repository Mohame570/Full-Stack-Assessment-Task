'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import type { UserSummary } from '@projectflow/shared';
import { Avatar } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useProjectMembers } from '@/features/projects/hooks';
import { useAssignTask } from '../hooks';

const UNASSIGNED_VALUE = '__unassigned__';
/** Show the search box only when the list is long enough to need it. */
const SEARCH_THRESHOLD = 5;

interface TaskAssigneeSelectProps {
  taskId: string;
  projectId: string;
  assignee: UserSummary | null;
}

export function TaskAssigneeSelect({ taskId, projectId, assignee }: TaskAssigneeSelectProps) {
  const { data: members, isPending, isError } = useProjectMembers(projectId);
  const assign = useAssignTask(taskId, projectId);
  const [filter, setFilter] = useState('');

  if (isPending) {
    return <Skeleton className="h-9 w-full" />;
  }

  if (isError || !members) {
    return (
      <p
        className="text-[13px] text-danger"
        title="Project members could not be loaded. Assignment is unavailable."
      >
        Could not load members.
      </p>
    );
  }

  if (members.length === 0) {
    return <p className="text-[13px] italic text-subtle-foreground">No project members.</p>;
  }

  const visible = members.filter((member) =>
    member.user.name.toLowerCase().includes(filter.trim().toLowerCase()),
  );

  return (
    <Select
      value={assignee?.id ?? UNASSIGNED_VALUE}
      disabled={assign.isPending}
      onValueChange={(value) => {
        const member = members.find((entry) => entry.user.id === value);
        assign.mutate(
          { assigneeId: value === UNASSIGNED_VALUE ? null : value, assignee: member?.user ?? null },
          { onError: (error: Error) => toast.error(error.message) },
        );
      }}
    >
      <SelectTrigger aria-label="Task assignee">
        <SelectValue placeholder="Unassigned" />
      </SelectTrigger>
      <SelectContent>
        {members.length > SEARCH_THRESHOLD ? (
          <div className="px-2 py-1.5" onKeyDown={(event) => event.stopPropagation()}>
            <Input
              placeholder="Search members..."
              aria-label="Search members"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          </div>
        ) : null}
        <SelectItem value={UNASSIGNED_VALUE}>Unassigned</SelectItem>
        {visible.length === 0 ? (
          <p className="px-2 py-1.5 text-[12px] text-subtle-foreground">No members found.</p>
        ) : (
          visible.map(({ user }) => (
            <SelectItem key={user.id} value={user.id}>
              <span className="flex items-center gap-2">
                <Avatar user={user} size="sm" />
                <span className="truncate">{user.name}</span>
              </span>
            </SelectItem>
          ))
        )}
      </SelectContent>
    </Select>
  );
}

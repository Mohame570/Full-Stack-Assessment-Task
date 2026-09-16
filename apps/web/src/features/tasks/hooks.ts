'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Paginated,
  TaskActivityEntry,
  TaskDetail,
  TaskStatus,
  TaskSummary,
  UserSummary,
} from '@projectflow/shared';
import { queryKeys } from '@/lib/query-keys';
import {
  assignTask,
  createTask,
  type CreateTaskPayload,
  fetchProjectTasks,
  fetchTask,
  fetchTaskActivity,
  updateTaskStatus,
} from './api';

export function useProjectTasks(projectId: string) {
  return useQuery<Paginated<TaskSummary>>({
    queryKey: queryKeys.projectTasks(projectId),
    queryFn: () => fetchProjectTasks(projectId),
    enabled: projectId.length > 0,
  });
}

export function useTask(taskId: string) {
  return useQuery<TaskDetail>({
    queryKey: queryKeys.task(taskId),
    queryFn: () => fetchTask(taskId),
    enabled: taskId.length > 0,
  });
}

export function useCreateTask(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation<TaskDetail, Error, CreateTaskPayload>({
    mutationFn: (payload) => createTask(projectId, payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.projectTasks(projectId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
      ]);
    },
  });
}

export function useUpdateTaskStatus(taskId: string, projectId: string) {
  const queryClient = useQueryClient();

  return useMutation<TaskDetail, Error, TaskStatus>({
    mutationFn: (status) => updateTaskStatus(taskId, status),
    onSuccess: async (task) => {
      queryClient.setQueryData(queryKeys.task(taskId), task);
      await queryClient.invalidateQueries({ queryKey: queryKeys.projectTasks(projectId) });
    },
  });
}
export function useTaskActivity(taskId: string) {
  return useQuery<Paginated<TaskActivityEntry>>({
    queryKey: queryKeys.taskActivity(taskId),
    queryFn: () => fetchTaskActivity(taskId),
    enabled: taskId.length > 0,
  });
}

interface AssignVariables {
  assigneeId: string | null;
  assignee: UserSummary | null;
}

export function useAssignTask(taskId: string, projectId: string) {
  const queryClient = useQueryClient();

  return useMutation<TaskDetail, Error, AssignVariables, { previous: TaskDetail | undefined }>({
    mutationFn: ({ assigneeId }) => assignTask(taskId, assigneeId),
    onMutate: async ({ assignee }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.task(taskId) });
      const previous = queryClient.getQueryData<TaskDetail>(queryKeys.task(taskId));
      if (previous) {
        queryClient.setQueryData<TaskDetail>(queryKeys.task(taskId), { ...previous, assignee });
      }
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.task(taskId), context.previous);
      }
    },
    onSuccess: async (task) => {
      queryClient.setQueryData(queryKeys.task(taskId), task);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.projectTasks(projectId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.taskActivity(taskId) }),
      ]);
    },
  });
}

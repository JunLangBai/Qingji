import type { Task } from "@qingji/domain";
import { useCallback, useSyncExternalStore } from "react";
import {
  getTaskSnapshot,
  getTaskStoreSnapshot,
  getTasksSnapshot,
  subscribeTasks,
  type TaskStoreSnapshot,
} from "./taskStore";

export function useTasks(): Task[] {
  return useSyncExternalStore(
    subscribeTasks,
    getTasksSnapshot,
    getTasksSnapshot,
  );
}

export function useTask(taskId: string): Task | undefined {
  const getSnapshot = useCallback(
    () => getTaskSnapshot(taskId),
    [taskId],
  );
  return useSyncExternalStore(
    subscribeTasks,
    getSnapshot,
    getSnapshot,
  );
}

export function useTaskStoreState(): TaskStoreSnapshot {
  return useSyncExternalStore(
    subscribeTasks,
    getTaskStoreSnapshot,
    getTaskStoreSnapshot,
  );
}

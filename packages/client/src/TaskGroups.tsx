import {
  getDueState,
  type Task,
  type TaskGroup,
} from "@qingji/domain";
import {
  CompleteTaskButton,
  type CompletionOrigin,
} from "./CompleteTaskButton";
import { formatCreatedOn, formatDue } from "./formatters";
import type { CompletionMode } from "./settingsStore";

interface TaskGroupsProps {
  groups: TaskGroup[];
  now: Date;
  isDesktop: boolean;
  focusedTaskId: string | null;
  selectionMode: boolean;
  selectedTaskIds: ReadonlySet<string>;
  completionMode: CompletionMode;
  onComplete(task: Task, origin: CompletionOrigin): void;
  onDelete(task: Task): void;
  onEdit(task: Task): void;
  onOpenSticky(task: Task): void;
  onToggleSelection(taskId: string): void;
}

export function TaskGroups({
  groups,
  now,
  isDesktop,
  focusedTaskId,
  selectionMode,
  selectedTaskIds,
  completionMode,
  onComplete,
  onDelete,
  onEdit,
  onOpenSticky,
  onToggleSelection,
}: TaskGroupsProps) {
  return (
    <div className="task-groups">
      {groups.map((group) => (
        <article className="task-group" key={group.createdOn}>
          <header>
            <div>
              <span className="date-chip">{group.createdOn}</span>
              <h4>{formatCreatedOn(group.createdOn)} 创建</h4>
            </div>
            <span>{group.tasks.length} 项</span>
          </header>
          <div className="task-list">
            {group.tasks.map((task) => {
              const state = getDueState(task, now);
              return (
                <div
                  className={[
                    "task-row",
                    state,
                    focusedTaskId === task.id ? "is-focused" : "",
                    selectedTaskIds.has(task.id) ? "is-selected" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  data-task-id={task.id}
                  key={task.id}
                >
                  {selectionMode ? (
                    <input
                      type="checkbox"
                      className="selection-checkbox"
                      aria-label={`选择 ${task.title}`}
                      checked={selectedTaskIds.has(task.id)}
                      onChange={() => onToggleSelection(task.id)}
                    />
                  ) : (
                    <CompleteTaskButton
                      mode={completionMode}
                      task={task}
                      onComplete={onComplete}
                    />
                  )}
                  <div className="task-copy">
                    <h5>{task.title}</h5>
                    {task.note ? <p>{task.note}</p> : null}
                    <div className="task-meta">
                      <span className={`due-label ${state}`}>
                        {state === "overdue"
                          ? "已逾期"
                          : state === "due-today"
                            ? "今天到期"
                            : "截止"}
                        {" · "}
                        {formatDue(task.dueAt)}
                      </span>
                    </div>
                  </div>
                  <div className="task-actions">
                    {isDesktop ? (
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => onOpenSticky(task)}
                      >
                        撕成便签
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => onEdit(task)}
                    >
                      编辑
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`删除 ${task.title}`}
                      onClick={() => onDelete(task)}
                    >
                      ×
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </article>
      ))}
    </div>
  );
}

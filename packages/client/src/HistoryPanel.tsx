import type { Task } from "@qingji/domain";
import { formatCompletedAt, formatDue } from "./formatters";
import { EmptyState } from "./EmptyState";

interface HistoryPanelProps {
  completed: Task[];
  visibleCompleted: Task[];
  createdDates: string[];
  selectedCreatedOn: string;
  focusedTaskId: string | null;
  selectionMode: boolean;
  selectedTaskIds: ReadonlySet<string>;
  onSelectCreatedOn(value: string): void;
  onRestore(task: Task): void;
  onToggleSelection(taskId: string): void;
  onToggleSelectionMode(): void;
}

export function HistoryPanel({
  completed,
  visibleCompleted,
  createdDates,
  selectedCreatedOn,
  focusedTaskId,
  selectionMode,
  selectedTaskIds,
  onSelectCreatedOn,
  onRestore,
  onToggleSelection,
  onToggleSelectionMode,
}: HistoryPanelProps) {
  return (
    <section className="content-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">HISTORY</p>
          <h3>完成记录</h3>
        </div>
        <div className="section-heading-actions">
          <button
            className={`text-button selection-mode-button ${selectionMode ? "active" : ""}`}
            type="button"
            aria-pressed={selectionMode}
            onClick={onToggleSelectionMode}
          >
            {selectionMode ? "退出多选" : "多选"}
          </button>
          <label className="history-filter">
            创建日期
            <select
              value={selectedCreatedOn}
              onChange={(event) => onSelectCreatedOn(event.target.value)}
            >
              <option value="">全部日期</option>
              {createdDates.map((date) => (
                <option value={date} key={date}>
                  {date}
                </option>
              ))}
            </select>
          </label>
          <span>{visibleCompleted.length} 项</span>
        </div>
      </div>
      {completed.length === 0 ? (
        <EmptyState title="还没有完成记录" body="完成的事情会留在这里。" />
      ) : visibleCompleted.length === 0 ? (
        <EmptyState
          title="这个创建日期没有记录"
          body="换一个日期，或清除筛选。"
        />
      ) : (
        <div className="history-list">
          {visibleCompleted.map((task) => (
            <article
              className={[
                "history-row",
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
                <span className="done-check">✓</span>
              )}
              <div>
                <h4>{task.title}</h4>
                <p>
                  创建于 {task.createdOn} · 截止 {formatDue(task.dueAt)}
                </p>
              </div>
              <time>
                完成于 {formatCompletedAt(task.completedAt ?? task.updatedAt)}
              </time>
              <button
                className="text-button history-restore-button"
                type="button"
                onClick={() => onRestore(task)}
              >
                恢复到待办
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

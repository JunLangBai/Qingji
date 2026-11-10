import type { Task } from "@qingji/domain";
import { useState } from "react";
import { toDateTimeLocal } from "./formatters";

interface TaskEditorDialogProps {
  task: Task;
  onClose(): void;
  onSave(input: {
    title: string;
    note?: string;
    dueAt: string;
    notificationLeadMinutes: Task["notificationLeadMinutes"];
  }): Promise<void>;
}

function leadChoice(value: Task["notificationLeadMinutes"]): string {
  if (value === undefined || value === null) return "default";
  if (value === -1) return "none";
  return String(value);
}

function parseLeadChoice(
  value: string,
): Task["notificationLeadMinutes"] {
  if (value === "default") return null;
  if (value === "none") return -1;
  return Number(value) as Task["notificationLeadMinutes"];
}

export function TaskEditorDialog({
  task,
  onClose,
  onSave,
}: TaskEditorDialogProps) {
  const [title, setTitle] = useState(task.title);
  const [note, setNote] = useState(task.note ?? "");
  const [dueAt, setDueAt] = useState(() =>
    toDateTimeLocal(new Date(task.dueAt)),
  );
  const [notificationChoice, setNotificationChoice] = useState(() =>
    leadChoice(task.notificationLeadMinutes),
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim()) {
      setError("事项标题不能为空");
      return;
    }
    if (!dueAt) {
      setError("请选择截止时间");
      return;
    }

    setSaving(true);
    try {
      await onSave({
        title,
        note,
        dueAt,
        notificationLeadMinutes: parseLeadChoice(notificationChoice),
      });
    } catch {
      setError("保存失败，请重试");
      setSaving(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        className="settings-panel edit-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-task-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <p className="eyebrow">EDIT ITEM</p>
            <h2 id="edit-task-title">编辑事项</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="关闭编辑"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <form onSubmit={(event) => void handleSubmit(event)}>
          <label className="edit-field">
            <span>事项标题</span>
            <input
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              autoComplete="off"
            />
          </label>
          <label className="edit-field">
            <span>补充说明</span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              placeholder="可选"
            />
          </label>
          <label className="edit-field">
            <span>截止时间</span>
            <input
              type="datetime-local"
              value={dueAt}
              onChange={(event) => setDueAt(event.target.value)}
            />
          </label>
          <label className="edit-field">
            <span>提醒</span>
            <select
              value={notificationChoice}
              onChange={(event) =>
                setNotificationChoice(event.target.value)
              }
            >
              <option value="default">跟随当前设备默认</option>
              <option value="none">不提醒</option>
              <option value="0">到期时</option>
              <option value="5">提前 5 分钟</option>
              <option value="15">提前 15 分钟</option>
              <option value="30">提前 30 分钟</option>
              <option value="60">提前 1 小时</option>
              <option value="1440">提前 1 天</option>
            </select>
          </label>
          {error ? <p className="form-error">{error}</p> : null}
          <div className="edit-actions">
            <button
              className="text-button"
              type="button"
              onClick={onClose}
            >
              取消
            </button>
            <button className="primary-button" type="submit" disabled={saving}>
              {saving ? "保存中" : "保存修改"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

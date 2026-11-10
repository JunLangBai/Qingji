import type { Task } from "@qingji/domain";
import { useState } from "react";
import { toDateTimeLocal } from "./formatters";
import { createTask } from "./taskStore";

interface TaskCaptureCardProps {
  defaultLeadMinutes: number;
  onCreated(): void;
}

function initialDueAt(): string {
  return toDateTimeLocal(new Date(Date.now() + 60 * 60 * 1000));
}

function parseLeadChoice(
  value: string,
): Task["notificationLeadMinutes"] {
  if (value === "default") return null;
  if (value === "none") return -1;
  return Number(value) as Task["notificationLeadMinutes"];
}

export function TaskCaptureCard({
  defaultLeadMinutes,
  onCreated,
}: TaskCaptureCardProps) {
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [dueAt, setDueAt] = useState(initialDueAt);
  const [notificationChoice, setNotificationChoice] = useState("default");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const defaultLeadLabel =
    defaultLeadMinutes === 0
      ? "到期时"
      : defaultLeadMinutes === 60
        ? "提前 1 小时"
        : defaultLeadMinutes === 1_440
          ? "提前 1 天"
          : `提前 ${defaultLeadMinutes} 分钟`;

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim()) {
      setError("先写下要完成的事情");
      return;
    }
    if (!dueAt) {
      setError("请选择截止时间");
      return;
    }

    setCreating(true);
    try {
      await createTask({
        title,
        dueAt,
        note,
        notificationLeadMinutes: parseLeadChoice(notificationChoice),
      });
      setTitle("");
      setNote("");
      setDueAt(initialDueAt());
      setNotificationChoice("default");
      setError("");
      onCreated();
    } catch {
      setError("暂时无法保存，请重试");
    } finally {
      setCreating(false);
    }
  }

  return (
    <section className="capture-card">
      <form onSubmit={(event) => void handleCreate(event)} className="capture-form">
        <div className="capture-main">
          <label className="capture-field capture-title-field" htmlFor="new-title">
            <span>事项内容</span>
            <textarea
              id="new-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="例如：周五前提交方案"
              rows={2}
              autoComplete="off"
            />
          </label>
          <label className="capture-field capture-note-field" htmlFor="new-note">
            <span>补充说明（可选）</span>
            <textarea
              id="new-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="补充地点、联系人或执行细节"
              rows={2}
              autoComplete="off"
            />
          </label>
        </div>
        <div className="capture-footer">
          <div className="capture-fields">
            <label>
              截止
              <input
                type="datetime-local"
                value={dueAt}
                onChange={(event) => setDueAt(event.target.value)}
              />
            </label>
            <label>
              提醒
              <select
                value={notificationChoice}
                onChange={(event) =>
                  setNotificationChoice(event.target.value)
                }
              >
                <option value="default">
                  跟随默认（{defaultLeadLabel}）
                </option>
                <option value="none">不提醒</option>
                <option value="0">到期时</option>
                <option value="5">提前 5 分钟</option>
                <option value="15">提前 15 分钟</option>
                <option value="30">提前 30 分钟</option>
                <option value="60">提前 1 小时</option>
                <option value="1440">提前 1 天</option>
              </select>
            </label>
          </div>
          <button className="primary-button" type="submit" disabled={creating}>
            <span>＋</span> {creating ? "保存中" : "记下"}
          </button>
        </div>
        {error ? <p className="form-error">{error}</p> : null}
      </form>
    </section>
  );
}

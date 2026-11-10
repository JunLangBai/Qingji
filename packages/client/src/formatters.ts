const dueFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const stickyDueFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const createdOnFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "long",
  day: "numeric",
  weekday: "short",
});

const completedFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const todayFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "long",
  day: "numeric",
  weekday: "long",
});

export function toDateTimeLocal(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function formatDue(iso: string): string {
  return dueFormatter.format(new Date(iso));
}

export function formatStickyDue(iso: string): string {
  return stickyDueFormatter.format(new Date(iso));
}

export function formatCreatedOn(dateKey: string): string {
  return createdOnFormatter.format(new Date(`${dateKey}T00:00:00`));
}

export function formatCompletedAt(iso: string): string {
  return completedFormatter.format(new Date(iso));
}

export function formatToday(date: Date): string {
  return todayFormatter.format(date);
}

export function EmptyState({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <div className="empty-state">
      <div className="empty-flower">○</div>
      <h4>{title}</h4>
      <p>{body}</p>
    </div>
  );
}

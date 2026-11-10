export interface LiveSocket {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: "message", listener: (data: unknown) => void): void;
  on(event: "close", listener: () => void): void;
}

export class LiveHub {
  private readonly sockets = new Map<string, Set<LiveSocket>>();

  add(userId: string, socket: LiveSocket): void {
    const existing = this.sockets.get(userId) ?? new Set<LiveSocket>();
    existing.add(socket);
    this.sockets.set(userId, existing);
  }

  remove(userId: string, socket: LiveSocket): void {
    const existing = this.sockets.get(userId);
    if (!existing) return;
    existing.delete(socket);
    if (existing.size === 0) this.sockets.delete(userId);
  }

  notify(userId: string): void {
    const message = JSON.stringify({ type: "sync-available" });
    for (const socket of this.sockets.get(userId) ?? []) {
      if (socket.readyState === 1) {
        socket.send(message);
      }
    }
  }
}

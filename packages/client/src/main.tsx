import {
  Component,
  StrictMode,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

class AppErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("清记界面发生未处理错误", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="loading-screen" role="alert">
        <div className="loading-card error">
          <strong>界面发生错误</strong>
          <p>{this.state.error.message || "请重新加载应用"}</p>
          <button
            className="secondary-button"
            type="button"
            onClick={() => window.location.reload()}
          >
            重新加载
          </button>
        </div>
      </main>
    );
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
);

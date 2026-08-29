"use client";

import React from "react";

interface State {
  hasError: boolean;
  error?: Error;
}

/**
 * Client-side error boundary rendered once in the root layout.
 * Catches render errors in the client tree and shows a minimal fallback
 * instead of a blank white screen.
 */
export default class ErrorBoundaryClient extends React.Component<
  { children?: React.ReactNode },
  State
> {
  constructor(props: { children?: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error("[ErrorBoundaryClient] Uncaught render error:", error, info);
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 24, color: "#ff6b6b", fontFamily: "monospace" }}>
          <h2>Something went wrong.</h2>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>
            {this.state.error?.message ?? "Unknown error"}
          </pre>
          <button
            onClick={() => this.setState({ hasError: false, error: undefined })}
            style={{ marginTop: 12, cursor: "pointer" }}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children ?? null;
  }
}

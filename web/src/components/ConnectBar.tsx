"use client";

import { useState } from "react";
import { SOURCE_OPTIONS, useCamera, type SourceId } from "@/context/camera-context";

export function ConnectBar() {
  const { status, error, connect, disconnect } = useCamera();
  const [choice, setChoice] = useState<SourceId>("webcam");

  return (
    <header className="bar">
      <h1>ESP Camera</h1>
      <div className="bar-controls">
        <select
          aria-label="Camera source"
          value={choice}
          onChange={(e) => setChoice(e.target.value as SourceId)}
          disabled={status !== "disconnected"}
        >
          {Object.entries(SOURCE_OPTIONS).map(([id, option]) => (
            <option key={id} value={id}>
              {option.label}
            </option>
          ))}
          <option disabled>USB (coming soon)</option>
        </select>
        <button
          onClick={status === "connected" ? disconnect : () => connect(choice)}
          disabled={status === "connecting"}
        >
          {status === "connected" ? "Disconnect" : "Connect"}
        </button>
        <span className="status" data-status={status} role="status">
          {status}
        </span>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </header>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { SOURCE_OPTIONS, useCamera, type SourceId } from "@/context/camera-context";
import { FirmwareButton } from "./FirmwareButton";

export function ConnectBar() {
  const { status, error, connect, disconnect } = useCamera();
  const [choice, setChoice] = useState<SourceId>("usb");
  const onDevice = usePathname().startsWith("/device");
  const [updating, setUpdating] = useState(false); // firmware update holds the serial port

  return (
    <header className="bar">
      <h1>ESP Camera</h1>
      <nav className="tabs" aria-label="Pages">
        <Link href="/" aria-current={onDevice ? undefined : "page"}>
          Camera
        </Link>
        <Link href="/device/" aria-current={onDevice ? "page" : undefined}>
          Device
        </Link>
      </nav>
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
        </select>
        <button
          onClick={status === "connected" ? disconnect : () => connect(choice)}
          disabled={status === "connecting" || updating}
        >
          {status === "connected" ? "Disconnect" : "Connect"}
        </button>
        <span className="status" data-status={status} role="status">
          {status}
        </span>
        <FirmwareButton onBusyChange={setUpdating} />
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </header>
  );
}

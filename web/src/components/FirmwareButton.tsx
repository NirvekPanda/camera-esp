"use client";

import { useState } from "react";
import { useCamera } from "@/context/camera-context";
import { USB_FILTERS } from "@/lib/camera/serial-source";
import { esptoolFlasher, fetchFirmwareFile, updateFirmware } from "@/lib/firmware";

async function requestPort() {
  if (!("serial" in navigator)) throw new Error("WebSerial isn't supported in this browser");
  return navigator.serial.requestPort({ filters: USB_FILTERS });
}

/** Flashes the camera with the firmware this site serves (/firmware/, exported by `make build`). */
export function FirmwareButton({ onBusyChange }: { onBusyChange(busy: boolean): void }) {
  const { status, release } = useCamera();
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function update() {
    setResult(null);
    setProgress(0);
    onBusyChange(true);
    try {
      const version = await updateFirmware({
        release,
        requestPort,
        fetchFile: fetchFirmwareFile,
        flasher: esptoolFlasher,
        onProgress: setProgress,
      });
      setResult(`Firmware ${version} installed`);
    } catch (e) {
      setResult(`Firmware update failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setProgress(null);
      onBusyChange(false);
    }
  }

  return (
    <>
      {/* Not while a connection is being set up: both need the one serial port. */}
      <button onClick={update} disabled={progress !== null || status === "connecting"}>
        {progress === null ? "Update firmware" : `Updating ${Math.round(progress * 100)}%`}
      </button>
      {result && (
        <span className="firmware-result" aria-live="polite">
          {result}
        </span>
      )}
    </>
  );
}

"use client";

import { useState } from "react";
import { useCamera } from "@/context/camera-context";
import { parsePhotoDate } from "@/lib/filename";
import { ImageModal } from "./ImageModal";

const formatSize = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;

const formatDate = (name: string) =>
  parsePhotoDate(name)?.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" }) ?? "";

export function FileList() {
  const { source, status, files, refreshFiles } = useCamera();
  const [openName, setOpenName] = useState<string | null>(null);
  const live = status === "connected";

  return (
    <section className="files" aria-labelledby="files-heading">
      <div className="files-head">
        <h2 id="files-heading">Photos ({files.length})</h2>
        <button onClick={refreshFiles} disabled={!live}>
          Refresh
        </button>
      </div>
      {files.length === 0 ? (
        <p className="empty">{live ? "No photos" : "No camera connected"}</p>
      ) : (
        <ul>
          {files.map((file) => (
            <li key={file.name}>
              <button className="file" onClick={() => setOpenName(file.name)}>
                <span className="file-name">{file.name}</span>
                <span className="file-meta">{formatDate(file.name)}</span>
                <span className="file-meta">{formatSize(file.size)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {source && openName && files.some((f) => f.name === openName) && (
        <ImageModal
          source={source}
          files={files}
          name={openName}
          onNavigate={setOpenName}
          onClose={() => setOpenName(null)}
        />
      )}
    </section>
  );
}

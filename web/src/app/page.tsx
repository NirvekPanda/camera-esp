import { ConnectBar } from "@/components/ConnectBar";
import { FileList } from "@/components/FileList";
import { LiveView } from "@/components/LiveView";
import { CameraProvider } from "@/context/camera-context";

export default function Home() {
  return (
    <CameraProvider>
      <ConnectBar />
      <main>
        <LiveView />
        <FileList />
      </main>
    </CameraProvider>
  );
}

import { FileList } from "@/components/FileList";
import { LiveView } from "@/components/LiveView";

export default function Home() {
  return (
    <main>
      <LiveView />
      <FileList />
    </main>
  );
}

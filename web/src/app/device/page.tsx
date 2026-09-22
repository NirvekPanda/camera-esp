import type { Metadata } from "next";
import { DeviceScreen } from "@/components/DeviceScreen";

export const metadata: Metadata = { title: "ESP Camera · Device" };

export default function Device() {
  return (
    <main>
      <DeviceScreen />
    </main>
  );
}

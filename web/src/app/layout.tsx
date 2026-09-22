import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ConnectBar } from "@/components/ConnectBar";
import { CameraProvider } from "@/context/camera-context";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ESP Camera",
  description: "Live preview and photos from the ESP32-S3 camera",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        {/* In the layout so the camera connection survives switching tabs. */}
        <CameraProvider>
          <ConnectBar />
          {children}
        </CameraProvider>
      </body>
    </html>
  );
}

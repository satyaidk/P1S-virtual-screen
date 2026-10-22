import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "P1S Virtual Screen",
  description: "Virtual 320×240 touchscreen and simulator for a Bambu Lab P1S with AMS",
};

export const viewport: Viewport = {
  themeColor: "#0a0c0d",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

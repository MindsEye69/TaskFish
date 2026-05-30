import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "taskfish — intelligent process manager",
  description: "See every running process, understand its purpose, and control your system.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

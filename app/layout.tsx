import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Paiflow starter",
  description: "Testnet checkout plumbing for your idea",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

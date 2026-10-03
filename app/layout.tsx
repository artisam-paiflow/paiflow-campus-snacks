import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Campus Snacks · Powered by Paiflow",
  description:
    "A campus snack stand that supports your student organisation with every testnet purchase.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Image Gen",
  description: "Pay-as-you-go image generation via OpenRouter",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

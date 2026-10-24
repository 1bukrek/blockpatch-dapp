import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BountyShield",
  description: "A testnet bug bounty submission and payout prototype.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

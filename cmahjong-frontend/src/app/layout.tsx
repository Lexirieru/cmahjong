import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "cMahjong",
  description:
    "Skill-based riichi mahjong. Four players compete for a stablecoin prize pool on Celo — no house cut.",
  icons: { icon: "/logos/cmahjong.png", apple: "/logos/cmahjong.png" },
  other: {
    // Talent App domain ownership verification
    "talentapp:project_verification":
      "54cabf52d6700880c398d47eb17f5bd782e57bb76ab6aab7de35f03d273649dc59f4be263b6535b14846f9de017fb2c8d2bbf757d9e34825ab0c172a4c6b6c22",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#0a3026",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} h-full antialiased`}>
      <body className="min-h-full">
        <div className="app-shell">{children}</div>
      </body>
    </html>
  );
}

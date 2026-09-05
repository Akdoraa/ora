import type { Metadata } from "next";
import { Plus_Jakarta_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

// Apfel Grotesk is a paid commercial typeface — no licensed copy available,
// not pirating it. Plus Jakarta Sans is the closest free, geometric-grotesque
// match and covers every weight the design needs, display + body + one font
// everywhere (no serif).
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-plex-mono",
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Ora — Pay by bank. Processing fees, solved.",
    template: "%s · Ora",
  },
  description:
    "The checkout for people and AI agents. Accept instant bank payments, settle globally, and keep more of every sale for a 1% processing fee.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${jakarta.variable} ${plexMono.variable}`}>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}

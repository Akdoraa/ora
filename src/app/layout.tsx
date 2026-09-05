import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Inter, DM_Sans, IBM_Plex_Mono } from "next/font/google";
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

// The checkout is a literal implementation of a specific Figma file, whose
// own spec is set in Inter — loaded separately and scoped to that page only
// (see .ora-checkout-bg / the checkout route), the rest of the product stays
// on Plus Jakarta Sans.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

// The dashboard components file (dash-template, node 2894:41872) specs its
// own type in DM Sans — loaded separately and scoped to /dashboard only.
const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  weight: ["400", "500", "700"],
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
    <html
      lang="en"
      className={`${jakarta.variable} ${inter.variable} ${dmSans.variable} ${plexMono.variable}`}
    >
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}

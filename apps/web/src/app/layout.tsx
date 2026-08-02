import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
  metadataBase: new URL("https://voltai.uz"),
  title: {
    default: "VoltAI",
    template: "%s | VoltAI",
  },
  description:
    "VoltAI helps you discover EV charging stations, compare options, and get directions quickly.",
  icons: {
    icon: [{ url: "/favicon.png", type: "image/png", sizes: "32x32" }],
    apple: [{ url: "/icon.png", type: "image/png", sizes: "1024x1024" }],
  },
  openGraph: {
    title: "VoltAI",
    description:
      "Find EV charging stations, compare options, and get directions quickly.",
    url: "https://voltai.uz",
    siteName: "VoltAI",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "VoltAI",
    description:
      "Find EV charging stations, compare options, and get directions quickly.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="uz">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased text-foreground`}
      >
        {children}
      </body>
    </html>
  );
}

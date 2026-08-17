import type { Metadata, Viewport } from "next";
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
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon.png", type: "image/png", sizes: "64x64" },
    ],
    apple: [{ url: "/icon.png", type: "image/png", sizes: "512x512" }],
  },
  openGraph: {
    title: "VoltAI",
    description:
      "Find EV charging stations, compare options, and get directions quickly.",
    url: "https://voltai.uz",
    siteName: "VoltAI",
    locale: "en_US",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "VoltAI" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "VoltAI",
    description:
      "Find EV charging stations, compare options, and get directions quickly.",
    images: ["/og.png"],
  },
};

/** Paints the browser chrome (mobile address bar, PWA splash) the app's background. */
export const viewport: Viewport = {
  themeColor: "#0b0f0d",
  colorScheme: "dark",
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

import { headers } from "next/headers";
import type { Metadata } from "next";

import { Open_Sans } from "next/font/google"

import { Site } from '@/app/components/Site'
import { siteTitle } from "@/app/config/text"

import "@/app/styles/globals.css"

const inter = Open_Sans({
  variable: "--font-open-sans",
  subsets: ['latin'],
  display: 'swap',
  // Preload font to reduce CLS
  preload: true,
  // Adjust fallback metrics
  adjustFontFallback: false,
})

export const metadata: Metadata = {
  title: siteTitle,
  description: "Feedback smarter, faster and better. Human-centric, automated, AI-assisted assessment feedback"
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.className}>
      <body>
        <Site>
          {children}
        </Site>
      </body>
    </html>
  );
}

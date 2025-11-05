import type { Metadata } from "next";

import { Inter } from "next/font/google"

import { Site } from '@/app/components/Site'

import "@/app/styles/globals.css"

const inter = Inter({
  variable: "--font-raleway-sans",
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: "Feedbacker",
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

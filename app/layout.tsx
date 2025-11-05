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
  description: "AI Generated Assessment Feedback",
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

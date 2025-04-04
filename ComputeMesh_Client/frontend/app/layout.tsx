import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'ComputeMesh',
  description: 'ComputeMesh - Decentralized AI Economy',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}

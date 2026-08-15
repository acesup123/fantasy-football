import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Navigation } from "@/components/layout/navigation";
import { AuthProvider } from "@/components/auth/auth-provider";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { ThemeScript } from "@/components/theme/theme-script";
import { PlayerModalProvider } from "@/components/player-modal-provider";
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
  title: "BANL Fantasy Football",
  description: "Draft, trade, and manage the BANL",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning: ThemeScript sets data-theme on <html> before
    // React hydrates, so the client tree never matches the server's bare markup.
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <AuthProvider>
          <ThemeProvider>
            <PlayerModalProvider>
              <div className="min-h-screen flex flex-col">
                <Navigation />
                <main className="flex-1 p-4 md:p-6 max-w-[1600px] mx-auto w-full">
                  {children}
                </main>
              </div>
            </PlayerModalProvider>
          </ThemeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}

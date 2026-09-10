import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import DevQuickSwitch from "@/components/DevQuickSwitch";
import CelebrationWatcher from "@/components/CelebrationWatcher";
import MessageBubbleWatcher from "@/components/MessageBubbleWatcher";
import { getCurrentSession } from "@/lib/session";
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
  title: "AuctionHous - TCG",
  description:
    "A P2P marketplace and live auction platform for trading cards and graded slabs — seller fees start at 7% + $0.30 and drop as low as 5.50% by seller tier, pay by bank and save.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const isDev = process.env.NODE_ENV === "development";
  // Only fetched in dev — this whole branch (and the DevQuickSwitch import
  // path that needs it) is dead-code-eliminated from production, same as
  // the panel itself.
  const { user } = isDev ? await getCurrentSession() : { user: null };

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full scroll-smooth antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <MessageBubbleWatcher>
          <CelebrationWatcher>{children}</CelebrationWatcher>
          {isDev && (
            <DevQuickSwitch
              currentEmail={user?.email ?? null}
              accountEmails={{
                seller: process.env.DEV_ACCOUNT_SELLER_EMAIL ?? null,
                bidderA: process.env.DEV_ACCOUNT_BIDDER_A_EMAIL ?? null,
                bidderB: process.env.DEV_ACCOUNT_BIDDER_B_EMAIL ?? null,
              }}
            />
          )}
        </MessageBubbleWatcher>
      </body>
    </html>
  );
}

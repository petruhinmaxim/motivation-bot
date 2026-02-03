import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Motivation Bot Dashboard",
  description: "Dashboard for Motivation Bot",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className="antialiased bg-slate-950 text-slate-100 min-h-screen">
        <header className="border-b border-slate-800 bg-slate-900/50">
          <div className="max-w-7xl mx-auto px-4 py-4">
            <h1 className="text-xl font-semibold">Motivation Bot — Дашборд</h1>
          </div>
        </header>
        <main className="max-w-7xl mx-auto px-4 py-8">{children}</main>
      </body>
    </html>
  );
}

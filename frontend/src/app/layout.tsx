import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from '@/components/AuthProvider';
import { ThemeProvider } from '@/components/ThemeProvider';

export const metadata: Metadata = {
  title: "KeepMedica CRM",
  description: "Gestão inteligente para sua clínica. Centralize WhatsApp e Instagram em um só lugar.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-br" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />
      </head>
      <body className="h-screen flex flex-col overflow-hidden bg-slate-50 text-slate-900 dark:bg-[#0A0A0A] dark:text-slate-100 transition-colors duration-300">
        <ThemeProvider>
          <AuthProvider>
            {children}
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Studio Next",
  description: "Éditeur vidéo web basé sur Next.js",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" className="dark">
      <head>
        {/* Ce meta tag aide à bloquer certains comportements de zoom sur mobile/trackpad */}
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
      </head>
      <body 
        className={`${inter.className} bg-black text-white h-screen w-screen overflow-hidden antialiased`}
        style={{ 
          // --- BLOCAGE RADICAL DU ZOOM ET DES GESTES NAVIGATEUR ---
          touchAction: 'none', 
          overscrollBehavior: 'none',
          // Empêche la sélection de texte accidentelle sur toute l'interface
          userSelect: 'none',
          WebkitUserSelect: 'none'
        }}
      >
        {children}
      </body>
    </html>
  );
}
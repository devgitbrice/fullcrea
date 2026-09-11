import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import UpdateNotifier from "@/components/UpdateNotifier";
import LastUpdateBadge from "@/components/LastUpdateBadge";
import ExternalLinkButton from "@/components/ExternalLinkButton";
import { Music, Scissors } from "lucide-react";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Gennn Cut",
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
        <div className="fixed right-4 top-4 z-50 flex items-center gap-2">
          <ExternalLinkButton href="https://audio.gennn.live" label="Audio" icon={<Music size={16} />} />
          <ExternalLinkButton href="https://cut.gennn.live" label="Cut" icon={<Scissors size={16} />} />
          <LastUpdateBadge />
        </div>
        <UpdateNotifier />
      </body>
    </html>
  );
}
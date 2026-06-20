import type { Metadata } from "next";
import Script from "next/script";
import "@/index.css";
import { Toaster } from "@/components/ui/sonner";
import { AppLayout } from "@/components/AppLayout";
import { PendoInit } from "@/components/PendoInit";

export const metadata: Metadata = {
  title: "PitchForge",
  description: "Pitch training against AI personas",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background text-foreground antialiased">
        <Script id="pendo-snippet" strategy="afterInteractive">{`
          (function(apiKey){
            (function(p,e,n,d,o){var v,w,x,y,z;o=p[d]=p[d]||{};o._q=o._q||[];
            v=['initialize','identify','updateOptions','pageLoad','track'];for(w=0,x=v.length;w<x;++w)(function(m){
              o[m]=o[m]||function(){o._q[m===v[0]?'unshift':'push']([m].concat([].slice.call(arguments,0)));
            };})(v[w]);
            y=e.createElement(n);y.async=!0;y.src='https://cdn.pendo.io/agent/static/'+apiKey+'/pendo.js';
            z=e.getElementsByTagName(n)[0];z.parentNode.insertBefore(y,z);})(window,document,'script','pendo');
          })('5315572734820352');
        `}</Script>
        <PendoInit />
        <AppLayout>{children}</AppLayout>
        <Toaster
          position="top-center"
          theme="dark"
          toastOptions={{
            style: {
              background: "hsl(24 9% 8%)",
              border: "1px solid hsl(30 7% 14%)",
              color: "hsl(40 14% 92%)",
              fontFamily: "Space Grotesk, Inter, sans-serif",
            },
          }}
        />
      </body>
    </html>
  );
}

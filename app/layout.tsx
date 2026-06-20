import type { Metadata } from "next";
import "@/index.css";
import { Toaster } from "@/components/ui/sonner";
import { AppLayout } from "@/components/AppLayout";

export const metadata: Metadata = {
  title: "PitchForge",
  description: "Pitch training against AI personas",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background text-foreground antialiased">
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

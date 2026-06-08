import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { AppLayout } from "@/components/AppLayout";
import { routes } from "./routes";

const App = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          {routes.map((route, index) => (
            <Route key={index} path={route.path} element={route.element} />
          ))}
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
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
    </BrowserRouter>
  );
};

export default App;

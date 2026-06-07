import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { routes } from "./routes";

const App = () => {
  return (
    <BrowserRouter>
      <Routes>
        {routes.map((route, index) => (
          <Route key={index} path={route.path} element={route.element} />
        ))}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toaster
        position="top-right"
        theme="dark"
        toastOptions={{
          style: {
            background: "#16161F",
            border: "1px solid #2A2A3A",
            color: "#E2E2E8",
          },
        }}
      />
    </BrowserRouter>
  );
};

export default App;

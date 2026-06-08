import { lazy, Suspense } from "react";
import type { ReactNode } from "react";

const HomePage = lazy(() => import("./pages/HomePage"));
const SetupPage = lazy(() => import("./pages/SetupPage"));
const SessionPage = lazy(() => import("./pages/SessionPage"));
const FeedbackPage = lazy(() => import("./pages/FeedbackPage"));
const HistoryPage = lazy(() => import("./pages/HistoryPage"));
const RewindPage = lazy(() => import("./pages/RewindPage"));

const PageSuspense = ({ children }: { children: ReactNode }) => (
  <Suspense
    fallback={
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="w-2 h-2 rounded-full"
              style={{
                background: "hsl(38 94% 56%)",
                animation: `pulseDot 1s ease-in-out ${i * 0.2}s infinite`,
              }}
            />
          ))}
        </div>
      </div>
    }
  >
    {children}
  </Suspense>
);

export interface RouteConfig {
  name: string;
  path: string;
  element: ReactNode;
}

export const routes: RouteConfig[] = [
  {
    name: "Home",
    path: "/",
    element: (
      <PageSuspense>
        <HomePage />
      </PageSuspense>
    ),
  },
  {
    name: "Setup",
    path: "/setup",
    element: (
      <PageSuspense>
        <SetupPage />
      </PageSuspense>
    ),
  },
  {
    name: "Session",
    path: "/session",
    element: (
      <PageSuspense>
        <SessionPage />
      </PageSuspense>
    ),
  },
  {
    name: "Feedback",
    path: "/feedback",
    element: (
      <PageSuspense>
        <FeedbackPage />
      </PageSuspense>
    ),
  },
  {
    name: "History",
    path: "/history",
    element: (
      <PageSuspense>
        <HistoryPage />
      </PageSuspense>
    ),
  },
  {
    name: "Rewind",
    path: "/rewind",
    element: (
      <PageSuspense>
        <RewindPage />
      </PageSuspense>
    ),
  },
];

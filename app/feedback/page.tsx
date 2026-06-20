import { Suspense } from "react";
import FeedbackPage from "@/views/FeedbackPage";

export default function Page() {
  return (
    <Suspense>
      <FeedbackPage />
    </Suspense>
  );
}

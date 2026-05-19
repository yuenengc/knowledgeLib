import { Suspense } from "react";
import UploadPageClient from "./upload-page-client";

export default function UploadPage() {
  return (
    <Suspense fallback={null}>
      <UploadPageClient />
    </Suspense>
  );
}

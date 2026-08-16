import PhoneUploadClient from "@/components/sell-wizard/PhoneUploadClient";

// Deliberately no Header/Footer — this is a bare, mobile-only page reached
// by scanning a QR code from PhoneUploadPanel, never by direct site
// navigation. No login required either: the sessionId itself is the
// credential (see apps/api/internal/photosession's package doc).
export default async function PhoneUploadPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <PhoneUploadClient sessionId={sessionId} />;
}

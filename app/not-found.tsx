// Neutrale 404-Seite (verrät nichts über die Anwendung)
export default function NichtGefunden() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-white px-4 text-center text-[#0a0a0a]">
      <h1 className="text-5xl font-bold tracking-tight">404</h1>
      <p className="mt-3 text-neutral-600">Diese Seite wurde nicht gefunden.</p>
    </main>
  );
}

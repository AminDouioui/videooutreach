import type { Metadata } from 'next';

// Öffentliche Abmelde-Seite. GET zeigt nur den Button – abgemeldet wird erst per POST (Scanner!).
export const metadata: Metadata = { title: 'Abmelden', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const AKZENT = '#7b3aec';

export default async function AbmeldenSeite({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ ok?: string }> }) {
  const { slug } = await params;
  const { ok } = await searchParams;
  const fertig = ok === '1';

  return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', background: '#fff', color: '#0a0a0a' }}>
      <div style={{ width: '100%', maxWidth: 440, textAlign: 'center' }}>
        <p style={{ fontWeight: 700, fontSize: 22, margin: '0 0 28px' }}>
          Prozessia<span style={{ color: AKZENT }}>.</span>
        </p>
        {fertig ? (
          <>
            <h1 style={{ fontSize: 24, margin: '0 0 12px' }}>Abgemeldet</h1>
            <p style={{ color: '#444', lineHeight: 1.6, margin: 0 }}>Sie erhalten keine weiteren E-Mails.</p>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: 24, margin: '0 0 12px' }}>Möchten Sie keine E-Mails mehr erhalten?</h1>
            <p style={{ color: '#444', lineHeight: 1.6, margin: '0 0 28px' }}>Mit einem Klick tragen wir Ihre Adresse in unsere Sperrliste ein. Danach schreiben wir Ihnen nicht mehr.</p>
            <form method="post" action={`/api/unsubscribe/${encodeURIComponent(slug)}`}>
              <input type="hidden" name="seite" value="1" />
              <button
                type="submit"
                style={{ background: AKZENT, color: '#fff', border: 0, borderRadius: 999, padding: '14px 28px', fontSize: 16, fontWeight: 600, cursor: 'pointer', width: '100%', maxWidth: 360 }}
              >
                Keine weiteren E-Mails erhalten
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}

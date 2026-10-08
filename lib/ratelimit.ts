/** Einfacher In-Memory-Limiter (Fixed Window je Schlüssel). */
export class RateLimiter {
  private eintraege = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly max: number,
    private readonly fensterMs: number,
  ) {}

  private aufraeumen(jetzt: number) {
    if (this.eintraege.size < 1000) return;
    for (const [k, v] of this.eintraege) if (v.resetAt <= jetzt) this.eintraege.delete(k);
  }

  /** Zählt einen Versuch; true = erlaubt. */
  hit(key: string, jetzt = Date.now()): boolean {
    this.aufraeumen(jetzt);
    const e = this.eintraege.get(key);
    if (!e || e.resetAt <= jetzt) {
      this.eintraege.set(key, { count: 1, resetAt: jetzt + this.fensterMs });
      return true;
    }
    e.count += 1;
    return e.count <= this.max;
  }

  /** Prüft ohne zu zählen, ob das Limit bereits erreicht ist. */
  isBlocked(key: string, jetzt = Date.now()): boolean {
    const e = this.eintraege.get(key);
    return !!e && e.resetAt > jetzt && e.count >= this.max;
  }

  reset(key: string) {
    this.eintraege.delete(key);
  }
}

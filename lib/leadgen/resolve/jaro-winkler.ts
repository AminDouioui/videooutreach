// Jaro-Winkler-Ähnlichkeit (0 bis 1) für Namensvergleiche

export function jaro(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const fenster = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aTreffer = new Array<boolean>(a.length).fill(false);
  const bTreffer = new Array<boolean>(b.length).fill(false);
  let treffer = 0;
  for (let i = 0; i < a.length; i++) {
    const von = Math.max(0, i - fenster);
    const bis = Math.min(b.length - 1, i + fenster);
    for (let j = von; j <= bis; j++) {
      if (bTreffer[j] || a[i] !== b[j]) continue;
      aTreffer[i] = bTreffer[j] = true;
      treffer++;
      break;
    }
  }
  if (!treffer) return 0;
  let vertauscht = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aTreffer[i]) continue;
    while (!bTreffer[k]) k++;
    if (a[i] !== b[k]) vertauscht++;
    k++;
  }
  const t = vertauscht / 2;
  return (treffer / a.length + treffer / b.length + (treffer - t) / treffer) / 3;
}

/** Jaro-Winkler mit Präfix-Bonus (Standard: Faktor 0,1, Präfix bis 4 Zeichen). */
export function jaroWinkler(a: string, b: string, faktor = 0.1): number {
  const j = jaro(a, b);
  let praefix = 0;
  while (praefix < Math.min(4, a.length, b.length) && a[praefix] === b[praefix]) praefix++;
  return j + praefix * faktor * (1 - j);
}

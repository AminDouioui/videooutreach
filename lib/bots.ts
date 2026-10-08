// Bot-Erkennung anhand des User-Agents (Mail-Scanner, Link-Previews, Crawler, Skripte)

const BOT_MUSTER: RegExp[] = [
  /bot\b/i,
  /bot[\/;\s)]/i,
  /crawler/i,
  /spider/i,
  /preview/i,
  /safelinks/i,
  /proofpoint/i,
  /mimecast/i,
  /barracuda/i,
  /headless/i,
  /python-requests/i,
  /\bcurl\//i,
  /\bwget\b/i,
  /go-http/i,
  /\bjava\//i,
  /okhttp/i,
  /microsoft office/i,
  /googleimageproxy/i,
  /ggpht\.com/i,
  /slurp/i,
  /facebookexternalhit/i,
  /whatsapp/i,
  /slackbot/i,
  /skypeuripreview/i,
  /outlook-ios|ms-office|msoffice/i,
  /mailscanner|urldefense|trendmicro|symantec|forcepoint|sophos/i,
];

/** true, wenn der User-Agent leer ist oder zu einem bekannten Bot/Scanner passt. */
export function isBotUserAgent(ua: string | null | undefined): boolean {
  const s = (ua ?? '').trim();
  if (!s) return true;
  return BOT_MUSTER.some((re) => re.test(s));
}

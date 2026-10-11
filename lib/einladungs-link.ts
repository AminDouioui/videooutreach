import { getEnv } from './env';

/** Vollständiger Einladungslink `${APP_URL}/einladung/<token>` */
export function einladungsLink(token: string): string {
  return `${getEnv().APP_URL.replace(/\/$/, '')}/einladung/${token}`;
}

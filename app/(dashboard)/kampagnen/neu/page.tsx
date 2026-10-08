import { NewCampaignForm } from '@/components/NewCampaignForm';
import { getEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';

export default function NeueKampagnePage() {
  return (
    <div className="max-w-xl">
      <h1 className="mb-4 text-xl font-semibold">Neue Kampagne</h1>
      <NewCampaignForm defaultCtaUrl={getEnv().DEFAULT_CTA_URL} />
    </div>
  );
}

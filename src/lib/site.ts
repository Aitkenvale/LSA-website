import { getEntry } from 'astro:content';

export async function getSiteSettings() {
  const entry = await getEntry('settings', 'site');
  if (!entry) throw new Error('Missing site settings (src/content/settings/site.yml)');
  return entry.data;
}

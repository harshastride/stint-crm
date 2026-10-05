import type { MetadataRoute } from 'next';

/** Makes the CRM installable on phones ("Add to Home screen"). Staff and the student portal share it; the portal opens from its own link. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Stint CRM',
    short_name: 'Stint',
    description: 'Stint Academy training and placement CRM',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    theme_color: '#4474B9',
    background_color: '#F7F8FA',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'New enquiry', short_name: 'Enquiry', url: '/p/enquiry', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'My follow-ups', short_name: 'Follow-ups', url: '/p/followups', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'Leads', short_name: 'Leads', url: '/p/lead', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
    ],
  };
}

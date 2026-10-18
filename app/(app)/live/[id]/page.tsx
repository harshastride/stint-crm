'use client';
import { use } from 'react';
import { LiveHelp } from '@/components/special/LiveHelp';

// Live help during a phone call with a lead: listens on the laptop mic, shows tips, then writes the call summary.
export default function LiveHelpPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <LiveHelp leadId={id} />;
}

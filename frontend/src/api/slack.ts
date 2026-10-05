import api from './client';

export interface SlackStatus {
  configured: boolean;
  connected: boolean;
  teamId: string | null;
}

export async function fetchSlackStatus(): Promise<SlackStatus> {
  const response = await api.get<SlackStatus>('/slack/status');
  return response.data;
}

export async function disconnectSlack(): Promise<void> {
  await api.delete('/slack/disconnect');
}

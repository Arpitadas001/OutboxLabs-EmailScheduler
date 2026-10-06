import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { API_BASE_URL } from '../../api/client';
import { disconnectSlack, fetchSlackStatus } from '../../api/slack';

export default function SlackConnection() {
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: ['slack', 'status'],
    queryFn: fetchSlackStatus,
    retry: false,
  });
  const disconnect = useMutation({
    mutationFn: disconnectSlack,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['slack', 'status'] });
    },
  });

  if (status.isLoading) {
    return <span className="text-xs text-gray-500">Checking Slack…</span>;
  }
  if (status.isError) {
    return (
      <button className="btn-ghost" onClick={() => void status.refetch()}>
        Retry Slack status
      </button>
    );
  }
  if (!status.data) {
    return (
      <button className="btn-ghost" onClick={() => void status.refetch()}>
        Retry Slack status
      </button>
    );
  }
  if (!status.data.configured) {
    return <span className="text-xs text-gray-500">Slack OAuth not configured</span>;
  }
  if (status.data.connected) {
    return (
      <button
        className="btn-ghost"
        disabled={disconnect.isPending}
        onClick={() => disconnect.mutate()}
      >
        {disconnect.isPending ? 'Disconnecting…' : 'Disconnect Slack'}
      </button>
    );
  }

  return (
    <a
      className="btn-ghost"
      href={`${API_BASE_URL}/slack/connect`}
    >
      Connect Slack
    </a>
  );
}

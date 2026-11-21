import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';

import { keys } from './keys';

/** The server refuses a sixth connection, so the screen stops offering one. */
export const MAX_CONNECTIONS = 5;

// Unlike task edits, these writes never queue: a connection address is shown once, so creating one
// later, unattended, would produce an address nobody sees.
const immediate = { retry: false, networkMode: 'always' } as const;

export function useConnections() {
  return useQuery({ queryKey: keys.connections, queryFn: api.mcpConnections });
}

export function useCreateConnection() {
  const client = useQueryClient();
  return useMutation({
    ...immediate,
    mutationFn: api.createMcpConnection,
    onSettled: () => client.invalidateQueries({ queryKey: keys.connections }),
  });
}

export function useRemoveConnection() {
  const client = useQueryClient();
  return useMutation({
    ...immediate,
    mutationFn: api.deleteMcpConnection,
    onSettled: () => client.invalidateQueries({ queryKey: keys.connections }),
  });
}

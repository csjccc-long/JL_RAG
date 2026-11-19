/**
 * Per-conversation long-term memory mode picked from the composer.
 *
 * Kept in a module-level store rather than component state for two reasons:
 * the composer lives outside the send hooks (single- and multi-model layouts
 * mount it once per page), and a mode picked in a brand new conversation
 * survives the moment that conversation is created and receives its real id
 * (the value is parked under the empty key and adopted as the default).
 *
 * `auto` means "inherit the assistant setting" — the backend then falls back to
 * prompt_config.memory_mode and finally to its own inference, so a fresh
 * conversation behaves exactly as before this switch existed.
 */
import { create } from 'zustand';

export const ChatMemoryMode = {
  Auto: 'auto',
  Work: 'work',
  Chat: 'chat',
  Off: 'off',
} as const;

export type ChatMemoryModeType =
  (typeof ChatMemoryMode)[keyof typeof ChatMemoryMode];

/** The key used before a conversation has a server id. */
const PendingKey = '';

type ChatMemoryModeState = {
  modes: Record<string, ChatMemoryModeType>;
  setMode: (conversationId: string | undefined, mode: ChatMemoryModeType) => void;
};

export const useChatMemoryModeStore = create<ChatMemoryModeState>()((set) => ({
  modes: {},
  setMode: (conversationId, mode) =>
    set((state) => ({
      modes: { ...state.modes, [conversationId ?? PendingKey]: mode },
    })),
}));

/**
 * The mode in force for a conversation: its own pick, else the last pick made
 * in a conversation that had no id yet, else `auto`.
 */
export function resolveChatMemoryMode(
  conversationId?: string,
): ChatMemoryModeType {
  const { modes } = useChatMemoryModeStore.getState();
  return (
    modes[conversationId ?? PendingKey] ??
    modes[PendingKey] ??
    ChatMemoryMode.Auto
  );
}

export function useChatMemoryMode(
  conversationId?: string,
): ChatMemoryModeType {
  const key = conversationId ?? PendingKey;
  return useChatMemoryModeStore(
    (state) => state.modes[key] ?? state.modes[PendingKey] ?? ChatMemoryMode.Auto,
  );
}

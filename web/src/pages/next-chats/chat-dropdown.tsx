import {
  ConfirmDeleteDialog,
  ConfirmDeleteDialogNode,
} from '@/components/confirm-delete-dialog';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MenuCard } from '@/components/menu-card';
import { useDeleteChat } from '@/hooks/use-chat-request';
import { IDialog } from '@/interfaces/database/chat';
import { PenLine, Trash2 } from 'lucide-react';
import { MouseEventHandler, PropsWithChildren, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useRenameChat } from './hooks/use-rename-chat';

export function ChatDropdown({
  children,
  showChatRenameModal,
  chat,
}: PropsWithChildren &
  Pick<ReturnType<typeof useRenameChat>, 'showChatRenameModal'> & {
    chat: IDialog;
  }) {
  const { t } = useTranslation();
  const { deleteChat } = useDeleteChat();

  const handleShowChatRenameModal: MouseEventHandler<HTMLDivElement> =
    useCallback(
      (e) => {
        e.stopPropagation();
        showChatRenameModal(chat);
      },
      [chat, showChatRenameModal],
    );

  const handleDelete: MouseEventHandler<HTMLDivElement> = useCallback(() => {
    deleteChat(chat.id);
  }, [chat.id, deleteChat]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <MenuCard>
        <DropdownMenuItem onClick={handleShowChatRenameModal}>
          {t('common.rename')} <PenLine />
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <ConfirmDeleteDialog
          onOk={handleDelete}
          title={t('deleteModal.delChat')}
          content={{
            node: (
              <ConfirmDeleteDialogNode
                avatar={{ avatar: chat.icon, name: chat.name }}
                name={chat.name}
              />
            ),
          }}
        >
          <DropdownMenuItem
            className="text-state-error"
            onSelect={(e) => {
              e.preventDefault();
            }}
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            {t('common.delete')} <Trash2 />
          </DropdownMenuItem>
        </ConfirmDeleteDialog>
      </MenuCard>
    </DropdownMenu>
  );
}
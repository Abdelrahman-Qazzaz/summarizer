import { Link } from "react-router-dom";
import type { Conversation } from "../../lib/chat";

type ConversationSidebarProps = {
  conversations: Conversation[];
  activeConversationId?: string;
  loading: boolean;
};

export function ConversationSidebar({
  conversations,
  activeConversationId,
  loading,
}: ConversationSidebarProps) {
  return (
    <aside className="md:w-64 md:flex-shrink-0 space-y-3">
      <Link
        to="/chat"
        className="block w-full px-4 py-2.5 text-center text-sm font-semibold rounded-xl bg-primary-600 text-white hover:bg-primary-700 transition-colors"
      >
        New chat
      </Link>

      <div className="flex md:block gap-2 overflow-x-auto md:overflow-visible pb-1 md:pb-0 md:space-y-1">
        {loading ? (
          <div className="h-10 w-full rounded-lg bg-gray-100 dark:bg-gray-800 animate-pulse" />
        ) : conversations.length === 0 ? (
          <p className="px-2 py-3 text-xs text-gray-500 dark:text-gray-400">
            No conversations yet.
          </p>
        ) : (
          conversations.map((conversation) => (
            <Link
              key={conversation.id}
              to={`/chat/${conversation.id}`}
              title={conversation.title}
              className={`block flex-shrink-0 max-w-56 md:max-w-none px-3 py-2.5 rounded-lg text-sm truncate transition-colors ${
                conversation.id === activeConversationId
                  ? "bg-primary-100 dark:bg-primary-900/50 text-primary-800 dark:text-primary-200"
                  : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
              }`}
            >
              {conversation.title}
            </Link>
          ))
        )}
      </div>
    </aside>
  );
}

import { myMessages } from "@/lib/mock-account";
import MessageList from "@/components/MessageList";

export default function MessagesPage() {
  return (
    <div className="px-10 py-8 sm:px-12 lg:px-14">
      <h1 className="text-xl font-bold text-gray-900">Messages</h1>
      <p className="mt-1 text-sm text-gray-500">
        Conversations with buyers, sellers, and AuctionHous Support.
      </p>
      <MessageList threads={myMessages} />
    </div>
  );
}

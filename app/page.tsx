import ChatLink from '../components/ChatLink';

export default function HomePage() {
  return (
    <div className="p-4">
      <h1 className="font-serif text-2xl mb-4">Dashboard</h1>
      <ChatLink className="inline-block p-4 border rounded" children="Chat with Assistant" />
    </div>
  );
}

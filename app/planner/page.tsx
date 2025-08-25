import { getNotion } from '../../lib/clients/notion';
import SyncStripeButton from '../../components/SyncStripeButton';
import { getConfig } from '../../utils/config';

function readProp(page: any, name: string) {
  const prop = page.properties[name];
  if (!prop) return '';
  if (prop.type === 'title') return prop.title[0]?.plain_text || '';
  if (prop.type === 'rich_text') return prop.rich_text[0]?.plain_text || '';
  if (prop.type === 'select') return prop.select?.name || '';
  if (prop.type === 'date') return prop.date?.start || '';
  return '';
}

export default async function PlannerPage() {
  const notion = await getNotion();
  const { queueDb } = await getConfig('notion');
  const res = await notion.databases.query({ database_id: queueDb });
  const cols: Record<string, any[]> = { Queue: [], Running: [], Done: [] };
  for (const p of res.results) {
    const status = readProp(p, 'Status') || 'Queue';
    if (!cols[status]) cols[status] = [];
    cols[status].push(p);
  }

  const order = ['Queue', 'Running', 'Done'];

  return (
    <div className="p-4">
      <div className="mb-4">
        <SyncStripeButton />
      </div>
      <div className="flex gap-4 overflow-x-auto">
      {order.map((key) => (
        <div key={key} className="min-w-[250px] flex-1">
          <h2 className="mb-2 font-serif text-lg">{key}</h2>
          <div className="space-y-2">
            {cols[key]?.map((p) => {
              const title = readProp(p, 'Task');
              const last = readProp(p, 'Last Log') || readProp(p, 'Last Error');
              const updated = readProp(p, 'Last Updated') || readProp(p, 'Date Updated') || '';
              return (
                <div key={p.id} className="bg-white rounded shadow p-2 border">
                  <a href={p.url} target="_blank" className="block">
                    <div className="font-medium">{title}</div>
                    {last && <div className="text-sm text-gray-600">{last}</div>}
                    {updated && <div className="text-xs text-gray-400">{updated}</div>}
                  </a>
                  <div className="mt-2">
                    <SyncStripeButton rowId={p.id} label="Fix now" />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      </div>
    </div>
  );
}

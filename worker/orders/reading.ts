import { createDoc } from './drive';

export interface ReadingData {
  email: string;
  items: any[];
  form?: any;
}

export async function generateReading(env: any, data: ReadingData) {
  const tier = data.items?.[0]?.description || 'Reading';
  const title = `${tier} for ${data.email}`;
  const content = `Summary\n=======\n\nEmail: ${data.email}\nItems: ${data.items
    .map((i: any) => i.description || i.price?.id)
    .join(', ')}\n\nForm Data:\n${JSON.stringify(data.form || {}, null, 2)}\n\nSections\n--------\n\n1. Introduction\n2. Main Reading\n3. Conclusion`;
  return await createDoc(env, title, content);
}

import { generateReading } from './reading';
import { logOrder, updateOrderStatus } from './notion';

interface MessageBody {
  email: string;
  items: any[];
  form?: any;
  orderId?: string;
}

export interface Env {
  NOTION_TOKEN?: string;
  NOTION_API_KEY?: string;
  NOTION_DB_ORDERS?: string;
  GOOGLE_SERVICE_JSON?: string;
  ORDERS_DRIVE_FOLDER_ID?: string;
  GMAIL_TOKEN?: string;
}

export default {
  async queue(batch: any, env: Env) {
    for (const msg of batch.messages) {
      const { email, items, form, orderId } = msg.body;
      const { docId, pdfUrl } = await generateReading(env, { email, items, form });
      if (env.ORDERS_DRIVE_FOLDER_ID) {
        console.log(`Doc created in folder ${env.ORDERS_DRIVE_FOLDER_ID}:`, docId);
      }
      const tier = items?.[0]?.description || 'tier';
      if (orderId) {
        await updateOrderStatus(env, orderId, 'delivered', { driveDoc: docId, pdfLink: pdfUrl });
      } else {
        await logOrder(env, { id: docId, email, tier, status: 'delivered', driveDoc: docId, pdfLink: pdfUrl });
      }
      if (env.GMAIL_TOKEN) {
        // TODO: send email via Gmail API
        console.log('email sent to', email);
      } else {
        console.log('delivery', email, pdfUrl);
      }
    }
  },
};

import { describe, it, expect } from 'vitest';
import { renderTemplate } from '../src/fundraising/email';

describe('fundraising email templates', () => {
  it('renders outreach template', () => {
    const html = renderTemplate('outreach', {
      name: 'Alex',
      sender: 'Maggie',
      senderEmail: 'maggie@example.com',
      land: 'Coyote, NM',
      tags: 'test',
      donateOnce: 'https://one',
      donateRecurring: 'https://rec',
      notionPage: 'https://notion',
    });
    expect(html).toContain('Alex');
    expect(html).toContain('Coyote');
  });
});

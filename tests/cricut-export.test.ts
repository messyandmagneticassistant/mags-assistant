import { describe, it, expect } from 'vitest';
import { exportCricutCutFile, type CricutExportBundle } from '../src/fulfillment/cricut';

function createDriveStub() {
  const calls: any[] = [];
  const drive = {
    files: {
      create: async (args: any) => {
        calls.push(args);
        return {
          data: {
            id: `file-${calls.length}`,
            webViewLink: `https://example.com/${calls.length}`,
          },
        } as any;
      },
    },
  } as any;
  return { drive, calls };
}

describe('exportCricutCutFile', () => {
  it('combines icons into a grouped SVG and optional label overlay', async () => {
    const { drive, calls } = createDriveStub();
    const bundle: CricutExportBundle = {
      id: 'household-flow',
      name: 'Household Flow',
      household: 'Household',
      icons: [
        { slug: 'sunrise-anchor', label: 'Sunrise Anchor', description: 'sun', tags: ['sun'] },
        { slug: 'fallback', label: 'Fallback Icon', description: 'fallback', tags: [] },
      ],
    };

    const svg = '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="48" fill="#000" /></svg>';

    const result = await exportCricutCutFile(bundle, {
      drive,
      folderId: 'folder-123',
      library: [{ slug: 'sunrise-anchor', fileId: 'asset-1', name: 'Sunrise Anchor' }],
      fetchSvg: async () => svg,
      includeLabels: true,
      createLabelOverlay: true,
      size: 1.25,
    });

    expect(result.fileName).toBe('Cricut–Household–Household Flow–1-25in.svg');
    expect(result.iconCount).toBe(2);
    expect(result.labelOverlay?.fileName).toBe('Cricut–Household–Household Flow–Labels.pdf');
    expect(calls).toHaveLength(2);

    const svgBody = calls[0].media.body.toString();
    expect(svgBody).toContain('<clipPath');
    expect(svgBody).toContain('Fallback Icon');
  });
});

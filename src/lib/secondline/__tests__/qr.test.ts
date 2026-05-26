import { describe, it, expect } from 'vitest';
import { renderQrSvg } from '../qr';

describe('qr', () => {
  it('returns an SVG string for any URL', async () => {
    const svg = await renderQrSvg('https://secondline.smile-nola.com/u/aaaa2345');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('</svg>');
  });
});

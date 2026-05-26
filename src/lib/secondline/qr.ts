/**
 * Server-side QR code generation. Returns an SVG string suitable for
 * inlining in a print-ready page.
 */

import QRCode from 'qrcode';

export async function renderQrSvg(url: string, opts: { size?: number } = {}): Promise<string> {
  const size = opts.size ?? 320;
  return QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, width: size });
}

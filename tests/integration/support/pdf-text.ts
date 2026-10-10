// Extrai o texto de um PDF gerado com fontes padrao (WinAnsi): descomprime os streams e decodifica
// as strings hexadecimais dos operadores de texto. Serve para provar que o PDF e pesquisavel
// (RN-011) sem depender de leitor externo.
import { inflateSync } from 'node:zlib';

const decodeHex = (hex: string): string => Buffer.from(hex, 'hex').toString('latin1');

export function pdfText(pdf: Buffer): string {
  const source = pdf.toString('latin1');
  const chunks: string[] = [];
  const streams = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  for (const match of source.matchAll(streams)) {
    const raw = Buffer.from(match[1] ?? '', 'latin1');
    let content: string;
    try {
      content = inflateSync(raw).toString('latin1');
    } catch {
      content = raw.toString('latin1');
    }
    for (const text of content.matchAll(/\[([^\]]*)\]\s*TJ|<([0-9a-fA-F]+)>\s*Tj/g)) {
      if (text[1] !== undefined) {
        chunks.push(
          [...text[1].matchAll(/<([0-9a-fA-F]+)>/g)].map((h) => decodeHex(h[1] ?? '')).join(''),
        );
      } else {
        chunks.push(decodeHex(text[2] ?? ''));
      }
    }
  }
  return chunks.join('\n');
}

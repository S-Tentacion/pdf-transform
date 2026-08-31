import { readFile } from 'node:fs/promises';
import { createCanvas, loadImage } from '@napi-rs/canvas';

export async function embedLogo(pdf, logoPath) {
  try {
    const image = await loadImage(await readFile(logoPath));
    if (!image.width || !image.height) throw new Error('The image has no dimensions.');

    // pdf-lib accepts PNG/JPEG only. Canvas decodes common image uploads and
    // re-encodes them as a lossless PNG while preserving transparent pixels.
    const canvas = createCanvas(image.width, image.height);
    canvas.getContext('2d').drawImage(image, 0, 0, image.width, image.height);
    return pdf.embedPng(await canvas.encode('png'));
  } catch (error) {
    throw new Error(`Unable to use the logo image. Upload a valid PNG, JPEG, WebP, GIF, or SVG file. ${error.message}`);
  }
}

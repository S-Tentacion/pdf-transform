import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { PDFDocument, StandardFonts, rgb, PDFName, PDFArray, PDFDict, PDFString, PDFHexString } = require('pdf-lib');
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));

const A5 = { width: 595, height: 421 };

function usage(message) {
  if (message) console.error(`Error: ${message}\n`);
  console.error(`Usage: node transform-certyiq.js --input <source.pdf> --output <result.pdf> [--logo <replacement.png>] [--url <website>] [--email <address>]`);
  process.exitCode = message ? 1 : 0;
}

function parseArgs(argv) {
  const values = { url: 'https://dump4exam.vercel.app/', email: 'Dump4Exam@gmail.com', logo: path.join(moduleDirectory, 'assets', 'dump4exam.png') };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help') return { help: true };
    if (!['--input', '--logo', '--output', '--url', '--email'].includes(arg)) return { error: `Unknown option: ${arg}` };
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) return { error: `Missing value for ${arg}` };
    values[arg.slice(2)] = value;
    index += 1;
  }
  for (const key of ['input', 'output']) if (!values[key]) return { error: `Missing --${key}` };
  try {
    const url = new URL(values.url);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
  } catch {
    return { error: '--url must be an http(s) URL' };
  }
  if (!/^\S+@\S+\.\S+$/.test(values.email)) return { error: '--email must be a valid email address' };
  return values;
}

function scaleBox(page, { x, top, width, height }) {
  const { width: pageWidth, height: pageHeight } = page.getSize();
  return { x: x * pageWidth / A5.width, y: pageHeight - (top + height) * pageHeight / A5.height, width: width * pageWidth / A5.width, height: height * pageHeight / A5.height };
}

function cover(page, box) {
  page.drawRectangle({ ...scaleBox(page, box), color: rgb(1, 1, 1) });
}

function placeLogo(page, logo, box) {
  const target = scaleBox(page, box);
  const ratio = logo.width / logo.height;
  const width = target.width / target.height > ratio ? target.height * ratio : target.width;
  const height = target.width / target.height > ratio ? target.height : target.width / ratio;
  page.drawImage(logo, { x: target.x + (target.width - width) / 2, y: target.y + (target.height - height) / 2, width, height });
}

function placeNativeLogo(page, logo, { x, top, width, height }) {
  const logoRatio = logo.width / logo.height;
  const boxRatio = width / height;
  const drawWidth = boxRatio > logoRatio ? height * logoRatio : width;
  const drawHeight = boxRatio > logoRatio ? height : width / logoRatio;
  page.drawImage(logo, {
    x: x + (width - drawWidth) / 2,
    y: page.getHeight() - top - height + (height - drawHeight) / 2,
    width: drawWidth,
    height: drawHeight,
  });
}

function drawText(page, font, value, box, size, color = rgb(0.15, 0.18, 0.23)) {
  const target = scaleBox(page, box);
  page.drawText(value, { x: target.x, y: target.y + (target.height - size) / 2, size, font, color });
}

function replaceText(page, font, value, box, size, color) {
  cover(page, box);
  drawText(page, font, value, box, size, color);
}

function drawLines(page, font, lines, box, size, leading, color = rgb(0.25, 0.25, 0.25)) {
  cover(page, box);
  const target = scaleBox(page, box);
  lines.forEach((line, index) => page.drawText(line, { x: target.x, y: target.y + target.height - size - index * leading, size, font, color }));
}

function drawCenteredText(page, font, value, centerX, y, size, color) {
  page.drawText(value, { x: centerX - font.widthOfTextAtSize(value, size) / 2, y, size, font, color });
}

function drawCoverPlaceholder(page, logo, font) {
  // Remove the original vendor artwork and replace it with a Dump4Exam panel.
  cover(page, { x: 225, top: 16, width: 360, height: 292 });
  const panel = scaleBox(page, { x: 315, top: 70, width: 205, height: 184 });
  page.drawRectangle({ ...panel, color: rgb(0.06, 0.09, 0.15), borderColor: rgb(0.08, 0.58, 0.84), borderWidth: 1 });
  page.drawRectangle({ x: panel.x, y: panel.y + panel.height - 7, width: panel.width, height: 7, color: rgb(1, 0.45, 0.05) });
  placeLogo(page, logo, { x: 340, top: 94, width: 155, height: 30 });
  drawCenteredText(page, font, 'PRACTICE WITH CONFIDENCE', panel.x + panel.width / 2, panel.y + 83, 7, rgb(1, 1, 1));
  drawCenteredText(page, font, 'Updated exam material', panel.x + panel.width / 2, panel.y + 58, 8, rgb(0.76, 0.84, 0.92));
  drawCenteredText(page, font, 'Clear explanations', panel.x + panel.width / 2, panel.y + 40, 8, rgb(0.76, 0.84, 0.92));
  drawCenteredText(page, font, 'Study at your pace', panel.x + panel.width / 2, panel.y + 22, 8, rgb(0.76, 0.84, 0.92));
}

function drawAboutPlaceholder(page, logo, font) {
  // Replace the original testimonial collage with a Dump4Exam panel.
  cover(page, { x: 300, top: 0, width: 295, height: 421 });
  const panel = scaleBox(page, { x: 306, top: 0, width: 289, height: 421 });
  page.drawRectangle({ ...panel, color: rgb(0.06, 0.09, 0.15) });
  page.drawRectangle({ x: panel.x, y: panel.y + panel.height - 8, width: panel.width, height: 8, color: rgb(1, 0.45, 0.05) });
  placeLogo(page, logo, { x: 355, top: 67, width: 190, height: 38 });
  drawCenteredText(page, font, 'DUMP4EXAM STUDY SPACE', panel.x + panel.width / 2, panel.y + 224, 13, rgb(1, 1, 1));
  drawCenteredText(page, font, 'Focused practice. Clear progress.', panel.x + panel.width / 2, panel.y + 196, 9, rgb(0.72, 0.81, 0.9));
  [
    ['Practice questions', 157],
    ['Detailed explanations', 125],
    ['Updated learning material', 93],
  ].forEach(([label, offset]) => {
    page.drawRectangle({ x: panel.x + 48, y: panel.y + offset - 4, width: 7, height: 7, color: rgb(0.08, 0.62, 0.86) });
    drawCenteredText(page, font, label, panel.x + panel.width / 2 + 16, panel.y + offset - 5, 9, rgb(1, 1, 1));
  });
}

function annotationUri(annotation) {
  const action = annotation?.lookupMaybe(PDFName.of('A'), PDFDict);
  const uri = action?.get(PDFName.of('URI'));
  return uri instanceof PDFString || uri instanceof PDFHexString ? uri.decodeText() : '';
}

function removeCertyIqLinks(page, pdf) {
  const annotations = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  if (!annotations) return;
  const kept = PDFArray.withContext(pdf.context);
  for (let index = 0; index < annotations.size(); index += 1) {
    const reference = annotations.get(index);
    const annotation = pdf.context.lookupMaybe(reference, PDFDict);
    const isLink = annotation?.lookupMaybe(PDFName.of('Subtype'), PDFName)?.asString() === '/Link';
    if (isLink && /certyiq/i.test(annotationUri(annotation))) continue;
    kept.push(reference);
  }
  if (kept.size()) page.node.set(PDFName.of('Annots'), kept);
  else page.node.delete(PDFName.of('Annots'));
}

function addUriLink(page, pdf, box, url) {
  const target = scaleBox(page, box);
  const annotation = pdf.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [target.x, target.y, target.x + target.width, target.y + target.height], Border: [0, 0, 0], A: { S: 'URI', URI: PDFString.of(url) } });
  const reference = pdf.context.register(annotation);
  let annotations = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  if (!annotations) {
    annotations = PDFArray.withContext(pdf.context);
    page.node.set(PDFName.of('Annots'), annotations);
  }
  annotations.push(reference);
}

function drawCover(page, pdf, logo, font, url) {
  // The CertyIQ cover has two separate logo placements and one website address.
  cover(page, { x: 20, top: 18, width: 62, height: 62 });
  placeLogo(page, logo, { x: 25, top: 23, width: 52, height: 48 });
  drawCoverPlaceholder(page, logo, font);
  cover(page, { x: 25, top: 255, width: 175, height: 40 });
  placeLogo(page, logo, { x: 28, top: 260, width: 165, height: 27 });
  replaceText(page, font, 'Get certification quickly with the Dump4Exam premium exam material.', { x: 32, top: 350, width: 350, height: 13 }, 7);
  replaceText(page, font, url, { x: 32, top: 388, width: 250, height: 14 }, 8, rgb(0, 0.6, 0.8));
  addUriLink(page, pdf, { x: 32, top: 388, width: 250, height: 14 }, url);
}

function drawAbout(page, pdf, logo, font, url, email) {
  const orange = rgb(1, 0.44, 0.02);
  // Rebuild the left-hand introduction so no visible CertyIQ references remain.
  drawLines(page, font, ['About Dump4Exam'], { x: 34, top: 29, width: 270, height: 22 }, 15, 16);
  page.drawLine({ start: { x: 34, y: page.getHeight() - 55 }, end: { x: 160, y: page.getHeight() - 55 }, thickness: 1.3, color: orange });
  drawLines(page, font, [
    "We here at Dump4Exam eventually got enough of the industry's greedy exam",
    'paid for. Our team of IT professionals comes with years of experience in',
    'the IT industry. Prior to training Dump4Exam we worked in test areas where we',
    'observed the horrors of the paywall exam preparation system.',
    '',
    'The misuse of the preparation system has left our team disillusioned.',
    'And for that reason, we decided it was time to make a difference. We had',
    'to make in this way. Dump4Exam was created to provide quality materials',
    'without stealing from everyday people who are trying to make a living.',
  ], { x: 35, top: 64, width: 270, height: 98 }, 6.7, 10);
  replaceText(page, font, url, { x: 35, top: 232, width: 205, height: 14 }, 7, rgb(0, 0.6, 0.8));
  replaceText(page, font, `Mail us on - ${email}`, { x: 35, top: 250, width: 240, height: 14 }, 7, rgb(0, 0.6, 0.8));
  addUriLink(page, pdf, { x: 35, top: 232, width: 205, height: 14 }, url);
  addUriLink(page, pdf, { x: 35, top: 250, width: 240, height: 14 }, `mailto:${email}`);
  drawAboutPlaceholder(page, logo, font);
}

function drawPaperLink(page, pdf, font, url, baseline) {
  // These are portrait A4 pages. Use their real PDF coordinates so the link
  // never overlaps the Total line above it.
  const box = { x: 15, y: 0, width: page.getWidth() - 30, height: 58 };
  page.drawRectangle({ ...box, color: rgb(1, 1, 1) });
  page.drawText(`Link: ${url}`, { x: 20, y: baseline, size: 9, font, color: rgb(0, 0.65, 0.35) });
  const annotation = pdf.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [49, baseline - 4, 520, baseline + 13], Border: [0, 0, 0], A: { S: 'URI', URI: PDFString.of(url) } });
  const reference = pdf.context.register(annotation);
  let annotations = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  if (!annotations) {
    annotations = PDFArray.withContext(pdf.context);
    page.node.set(PDFName.of('Annots'), annotations);
  }
  annotations.push(reference);
}

function drawQuestionHeaderBrand(page, logo, header) {
  const { height } = page.getSize();
  const box = { x: header.x - 6, top: height - header.y - header.height - 4, width: header.width + 12, height: header.height + 7 };
  page.drawRectangle({ x: box.x, y: height - box.top - box.height, width: box.width, height: box.height, color: rgb(1, 1, 1) });
  placeNativeLogo(page, logo, { x: header.x - 4, top: height - header.y - header.height - 2, width: header.width + 8, height: header.height + 3 });
}

async function findQuestionHeaderBrands(sourceBytes, pageCount) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(sourceBytes), disableWorker: true });
  try {
    const source = await loadingTask.promise;
    const headers = [];
    for (let pageNumber = 4; pageNumber < pageCount; pageNumber += 1) {
      const page = await source.getPage(pageNumber);
      const text = await page.getTextContent();
      headers[pageNumber - 1] = text.items
        .filter(item => item.str.replace(/\s/g, '').toLowerCase() === 'certyiq')
        .map(item => ({ x: item.transform[4], y: item.transform[5], width: item.width, height: item.height }));
    }
    return headers;
  } finally {
    await loadingTask.destroy();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return usage();
  if (args.error) return usage(args.error);

  const sourceBytes = await readFile(args.input);
  const pdf = await PDFDocument.load(sourceBytes, { ignoreEncryption: true, updateMetadata: false });
  const logo = await pdf.embedPng(await readFile(args.logo));
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = pdf.getPages();
  const questionHeaderBrands = await findQuestionHeaderBrands(sourceBytes, pages.length);
  for (const page of pages) removeCertyIqLinks(page, pdf);
  if (pages[0]) drawCover(pages[0], pdf, logo, font, args.url);
  if (pages[1]) drawAbout(pages[1], pdf, logo, font, args.url, args.email);
  pages.forEach((page, index) => questionHeaderBrands[index]?.forEach(header => drawQuestionHeaderBrand(page, logo, header)));
  if (pages[2]) drawPaperLink(pages[2], pdf, font, args.url, 20);
  if (pages.at(-1)) {
    replaceText(pages.at(-1), font, `Mail us - ${args.email}`, { x: 231, top: 319, width: 155, height: 24 }, 7, rgb(0.3, 0.65, 0.38));
    addUriLink(pages.at(-1), pdf, { x: 231, top: 319, width: 155, height: 24 }, `mailto:${args.email}`);
    drawPaperLink(pages.at(-1), pdf, font, args.url, 20);
  }
  await mkdir(path.dirname(path.resolve(args.output)), { recursive: true });
  await writeFile(args.output, await pdf.save({ useObjectStreams: true }));
  console.log(`Wrote ${args.output} (${pages.length} pages).`);
}

main().catch(error => { console.error(error.message || error); process.exitCode = 1; });

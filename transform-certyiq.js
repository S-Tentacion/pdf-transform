import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { embedLogo } from './logo.js';
import { detectExamDetails } from './exam-details.js';

const require = createRequire(import.meta.url);
const { PDFDocument, StandardFonts, rgb, PDFName, PDFArray, PDFDict, PDFString, PDFHexString } = require('pdf-lib');
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));

const A5 = { width: 595, height: 421 };

function usage(message) {
  if (message) console.error(`Error: ${message}\n`);
  console.error(`Usage: node transform-certyiq.js --input <source.pdf> --output <result.pdf> [--logo <replacement-image>] [--url <website>] [--email <address>]`);
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

function wrapText(font, value, size, maxWidth, maxLines = 2) {
  const words = value.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    } else line = candidate;
  }
  if (lines.length < maxLines && line) lines.push(line);
  return lines;
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

function drawCover(page, pdf, logo, font, url, exam) {
  const { width, height } = page.getSize();
  const navy = rgb(0.06, 0.09, 0.15);
  const blue = rgb(0.08, 0.62, 0.86);
  const orange = rgb(1, 0.45, 0.05);

  page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(1, 1, 1) });
  page.drawRectangle({ x: 0, y: 0, width: 162, height, color: navy });
  page.drawCircle({ x: 44, y: height - 54, size: 22, color: blue, opacity: 0.35 });
  page.drawCircle({ x: 122, y: 42, size: 48, color: orange, opacity: 0.22 });
  page.drawRectangle({ x: 195, y: height - 78, width: 54, height: 6, color: orange });
  page.drawRectangle({ x: 195, y: height - 90, width: 118, height: 4, color: blue });
  page.drawRectangle({ x: 22, y: height - 140, width: 120, height: 106, color: rgb(1, 1, 1) });
  placeNativeLogo(page, logo, { x: 28, top: 39, width: 108, height: 96 });

  page.drawText('PREMIUM EXAM', { x: 29, y: height - 169, size: 11, font, color: rgb(1, 1, 1) });
  page.drawText('PREPARATION', { x: 29, y: height - 186, size: 11, font, color: rgb(1, 1, 1) });
  page.drawText('Built for focused practice', { x: 29, y: 74, size: 8, font, color: rgb(0.75, 0.84, 0.92) });
  page.drawText('and confident exam day.', { x: 29, y: 61, size: 8, font, color: rgb(0.75, 0.84, 0.92) });

  const titleLines = wrapText(font, exam.name, 12, 345);
  titleLines.forEach((line, index) => page.drawText(line, { x: 195, y: height - 145 - index * 21, size: 12, font, color: rgb(0.17, 0.2, 0.25) }));
  const codeY = height - (titleLines.length > 1 ? 224 : 203);
  page.drawText(exam.code, { x: 195, y: codeY, size: 34, font, color: navy });
  page.drawText('Your structured guide for practice questions,', { x: 195, y: codeY - 33, size: 10, font, color: rgb(0.35, 0.4, 0.47) });
  page.drawText('clear explanations, and steady progress.', { x: 195, y: codeY - 49, size: 10, font, color: rgb(0.35, 0.4, 0.47) });
  page.drawRectangle({ x: 195, y: 72, width: 260, height: 44, color: rgb(0.94, 0.97, 0.99) });
  page.drawText('Practice  •  Learn  •  Succeed', { x: 216, y: 88, size: 12, font, color: navy });
  page.drawText(url, { x: 195, y: 38, size: 8, font, color: blue });
  addUriLink(page, pdf, { x: 195, top: height - 49, width: 200, height: 15 }, url);
}

function drawAbout(page, pdf, logo, font, url, email) {
  const { width, height } = page.getSize();
  const navy = rgb(0.06, 0.09, 0.15);
  const blue = rgb(0.08, 0.62, 0.86);
  const orange = rgb(1, 0.45, 0.05);

  page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(1, 1, 1) });
  page.drawRectangle({ x: 0, y: height - 94, width, height: 94, color: navy });
  page.drawRectangle({ x: 28, y: height - 81, width: 76, height: 62, color: rgb(1, 1, 1) });
  placeNativeLogo(page, logo, { x: 33, top: 22, width: 66, height: 56 });
  page.drawText('ABOUT DUMP4EXAM', { x: 135, y: height - 58, size: 17, font, color: rgb(1, 1, 1) });
  page.drawRectangle({ x: 39, y: height - 119, width: 54, height: 5, color: orange });
  page.drawText('Study smarter. Build confidence. Be ready.', { x: 39, y: height - 147, size: 18, font, color: navy });
  page.drawText('Dump4Exam brings exam preparation into one focused space.', { x: 39, y: height - 176, size: 9, font, color: rgb(0.34, 0.39, 0.46) });
  page.drawText('Use practice material to identify gaps, learn from explanations,', { x: 39, y: height - 192, size: 9, font, color: rgb(0.34, 0.39, 0.46) });
  page.drawText('and progress toward exam day with clarity.', { x: 39, y: height - 208, size: 9, font, color: rgb(0.34, 0.39, 0.46) });

  const cards = [
    ['01', 'Practice', 'Work through focused', 'exam-style questions.'],
    ['02', 'Understand', 'Use explanations to', 'strengthen weak areas.'],
    ['03', 'Progress', 'Build momentum at', 'your own pace.'],
  ];
  cards.forEach(([number, title, lineOne, lineTwo], index) => {
    const x = 39 + index * 175;
    page.drawRectangle({ x, y: 91, width: 151, height: 104, color: rgb(0.95, 0.97, 0.99), borderColor: rgb(0.84, 0.9, 0.95), borderWidth: 0.6 });
    page.drawRectangle({ x, y: 176, width: 151, height: 19, color: index === 1 ? orange : blue });
    page.drawText(number, { x: x + 12, y: 181, size: 8, font, color: rgb(1, 1, 1) });
    page.drawText(title, { x: x + 12, y: 152, size: 12, font, color: navy });
    page.drawText(lineOne, { x: x + 12, y: 130, size: 8, font, color: rgb(0.34, 0.39, 0.46) });
    page.drawText(lineTwo, { x: x + 12, y: 117, size: 8, font, color: rgb(0.34, 0.39, 0.46) });
  });
  page.drawText(url, { x: 39, y: 43, size: 8, font, color: blue });
  page.drawText(email, { x: 39, y: 27, size: 8, font, color: blue });
  addUriLink(page, pdf, { x: 39, top: height - 54, width: 210, height: 14 }, url);
  addUriLink(page, pdf, { x: 39, top: height - 38, width: 210, height: 14 }, `mailto:${email}`);
}

function drawThankYouPage(page, logo, font, url, email) {
  const { width, height } = page.getSize();
  const navy = rgb(0.06, 0.09, 0.15);
  const blue = rgb(0.08, 0.62, 0.86);
  const orange = rgb(1, 0.45, 0.05);
  page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(1, 1, 1) });
  page.drawRectangle({ x: 0, y: 0, width: 74, height, color: navy });
  page.drawCircle({ x: 37, y: height - 92, size: 22, color: blue, opacity: 0.4 });
  page.drawCircle({ x: 37, y: 70, size: 33, color: orange, opacity: 0.35 });
  page.drawRectangle({ x: 226, y: height - 157, width: 146, height: 119, color: rgb(1, 1, 1) });
  placeNativeLogo(page, logo, { x: 235, top: 47, width: 128, height: 99 });
  drawCenteredText(page, font, 'THANK YOU', width / 2 + 32, height - 245, 31, navy);
  drawCenteredText(page, font, 'Best wishes for your exam.', width / 2 + 32, height - 279, 15, orange);
  drawCenteredText(page, font, 'You have put in the effort. Stay focused, trust your preparation,', width / 2 + 32, height - 325, 10, rgb(0.34, 0.39, 0.46));
  drawCenteredText(page, font, 'and take the next step with confidence.', width / 2 + 32, height - 343, 10, rgb(0.34, 0.39, 0.46));
  page.drawRectangle({ x: 146, y: height - 454, width: 342, height: 108, color: rgb(0.95, 0.97, 0.99) });
  ['Review key topics', 'Stay calm and focused', 'Believe in your progress'].forEach((label, index) => {
    const y = height - 382 - index * 27;
    page.drawCircle({ x: 178, y: y + 3, size: 6, color: index === 1 ? orange : blue });
    page.drawText(label, { x: 195, y, size: 11, font, color: navy });
  });
  drawCenteredText(page, font, 'Practice • Learn • Succeed', width / 2 + 32, 105, 14, navy);
  drawCenteredText(page, font, url, width / 2 + 32, 76, 9, blue);
  drawCenteredText(page, font, email, width / 2 + 32, 57, 9, blue);
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

async function inspectSourceContent(sourceBytes, pageCount) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(sourceBytes), disableWorker: true });
  try {
    const source = await loadingTask.promise;
    const headers = [];
    let lastPageText = '';
    for (let pageNumber = 4; pageNumber <= pageCount; pageNumber += 1) {
      const page = await source.getPage(pageNumber);
      const text = await page.getTextContent();
      if (pageNumber === pageCount) lastPageText = text.items.map(item => item.str).join(' ');
      headers[pageNumber - 1] = text.items
        .filter(item => item.str.replace(/\s/g, '').toLowerCase() === 'certyiq')
        .map(item => ({ x: item.transform[4], y: item.transform[5], width: item.width, height: item.height }));
    }
    return { headers, lastPageText };
  } finally {
    await loadingTask.destroy();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return usage();
  if (args.error) return usage(args.error);

  const sourceBytes = await readFile(args.input);
  const exam = await detectExamDetails(sourceBytes, args.input);
  const pdf = await PDFDocument.load(sourceBytes, { ignoreEncryption: true, updateMetadata: false });
  const logo = await embedLogo(pdf, args.logo);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const sourcePageCount = pdf.getPageCount();
  const { headers: questionHeaderBrands, lastPageText } = await inspectSourceContent(sourceBytes, sourcePageCount);
  if (/\bthank\s*you\b/i.test(lastPageText)) pdf.removePage(pdf.getPageCount() - 1);
  const pages = pdf.getPages();
  for (const page of pages) removeCertyIqLinks(page, pdf);
  if (pages[0]) drawCover(pages[0], pdf, logo, font, args.url, exam);
  if (pages[1]) drawAbout(pages[1], pdf, logo, font, args.url, args.email);
  pages.forEach((page, index) => questionHeaderBrands[index]?.forEach(header => drawQuestionHeaderBrand(page, logo, header)));
  if (pages[2]) drawPaperLink(pages[2], pdf, font, args.url, 20);
  const lastContentPage = pages.at(-1);
  const thankYouPage = pdf.addPage([lastContentPage?.getWidth() ?? A5.width, lastContentPage?.getHeight() ?? A5.height]);
  drawThankYouPage(thankYouPage, logo, font, args.url, args.email);
  await mkdir(path.dirname(path.resolve(args.output)), { recursive: true });
  await writeFile(args.output, await pdf.save({ useObjectStreams: true }));
  console.log(`Wrote ${args.output} (${pdf.getPageCount()} pages; ${exam.code}: ${exam.name}).`);
}

main().catch(error => { console.error(error.message || error); process.exitCode = 1; });

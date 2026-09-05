import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import createQpdf from '@neslinesli93/qpdf-wasm';
import { embedLogo } from './logo.js';
import { detectExamDetails } from './exam-details.js';

const require = createRequire(import.meta.url);
const { PDFDocument, StandardFonts, rgb, PDFName, PDFArray, PDFDict, PDFString, PDFHexString, pushGraphicsState, popGraphicsState, rectangle, clip, endPath } = require('pdf-lib');
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DUMP4EXAM_URL = 'https://dump4exam.vercel.app/';
const DEFAULT_DUMP4EXAM_EMAIL = 'Dump4Exam@gmail.com';
const DEFAULT_LOGO_PATH = path.join(moduleDirectory, 'assets', 'dump4exam.png');

const LETTER = { width: 612, height: 792 };

function usage(message) {
  if (message) console.error(`Error: ${message}\n`);
  console.error(`Usage:
  npm run transform -- --input <source.pdf> --output <result.pdf> [--logo <replacement-image>] [--url <website>] [--email <address>]

Options:
  --all-pages                 Put the replacement header on every page (including page 2).
  --ignore-encryption         Try PDFs with a permissions-only encryption flag.
  --rasterize                 Force rendering then rebuilding the PDF.
  --dpi <72-300>              Raster output resolution (default: 120).
  --jpeg-quality <50-95>      Raster JPEG quality (default: 65).
  --help                      Show this message.

The built-in coordinates are tuned for the supplied Letter-size PassLeader PDF.`);
  process.exitCode = message ? 1 : 0;
}

function parseArgs(argv) {
  const values = { allPages: false, ignoreEncryption: false, rasterize: false, dpi: 120, jpegQuality: 65, url: DEFAULT_DUMP4EXAM_URL, email: DEFAULT_DUMP4EXAM_EMAIL, logo: DEFAULT_LOGO_PATH };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help') return { help: true };
    if (arg === '--all-pages') { values.allPages = true; continue; }
    if (arg === '--ignore-encryption') { values.ignoreEncryption = true; continue; }
    if (arg === '--rasterize') { values.rasterize = true; continue; }
    if (!['--input', '--logo', '--output', '--dpi', '--jpeg-quality', '--url', '--email'].includes(arg)) return { error: `Unknown option: ${arg}` };
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) return { error: `Missing value for ${arg}` };
    if (arg === '--dpi') values.dpi = Number(value);
    else if (arg === '--jpeg-quality') values.jpegQuality = Number(value);
    else values[arg.slice(2)] = value;
    index += 1;
  }
  for (const key of ['input', 'output']) {
    if (!values[key]) return { error: `Missing --${key}` };
  }
  if (!Number.isInteger(values.dpi) || values.dpi < 72 || values.dpi > 300) return { error: '--dpi must be an integer between 72 and 300' };
  if (!Number.isInteger(values.jpegQuality) || values.jpegQuality < 50 || values.jpegQuality > 95) return { error: '--jpeg-quality must be an integer between 50 and 95' };
  try {
    const website = new URL(values.url);
    if (!['http:', 'https:'].includes(website.protocol)) throw new Error();
  } catch {
    return { error: '--url must be an http(s) URL' };
  }
  if (!/^\S+@\S+\.\S+$/.test(values.email)) return { error: '--email must be a valid email address' };
  return values;
}

function scaleBox(page, { x, top, width, height }) {
  const { width: pageWidth, height: pageHeight } = page.getSize();
  const sx = pageWidth / LETTER.width;
  const sy = pageHeight / LETTER.height;
  return {
    x: x * sx,
    y: pageHeight - (top + height) * sy,
    width: width * sx,
    height: height * sy,
  };
}

function cover(page, box) {
  page.drawRectangle({ ...scaleBox(page, box), color: rgb(1, 1, 1) });
}

function placeLogo(page, logo, box, focusY = 0.5) {
  const target = scaleBox(page, box);
  const logoRatio = logo.width / logo.height;
  const targetRatio = target.width / target.height;
  // Fill the existing PassLeader logo bands with the brand wordmark area.
  // Clipping keeps taller logo artwork inside the cleared rectangle.
  const width = targetRatio > logoRatio ? target.width : target.height * logoRatio;
  const height = targetRatio > logoRatio ? target.width / logoRatio : target.height;
  page.pushOperators(
    pushGraphicsState(),
    rectangle(target.x, target.y, target.width, target.height),
    clip(),
    endPath(),
  );
  page.drawImage(logo, {
    x: target.x + (target.width - width) / 2,
    y: target.y + target.height / 2 - height * focusY,
    width,
    height,
  });
  page.pushOperators(popGraphicsState());
}

function replaceText(page, font, { x, top, width, height, value, size, color = rgb(0, 0, 0) }) {
  cover(page, { x, top, width, height });
  const placement = scaleBox(page, { x, top, width, height });
  page.drawText(value, {
    x: placement.x,
    y: placement.y + (placement.height - size) / 2,
    size,
    font,
    color,
  });
}

function annotationUri(annotation) {
  const action = annotation?.lookupMaybe(PDFName.of('A'), PDFDict);
  const uri = action?.get(PDFName.of('URI'));
  return uri instanceof PDFString || uri instanceof PDFHexString ? uri.decodeText() : '';
}

function removePassLeaderLinks(page, pdf) {
  const annotations = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  if (!annotations) return;
  const kept = PDFArray.withContext(pdf.context);
  for (let index = 0; index < annotations.size(); index += 1) {
    const reference = annotations.get(index);
    const annotation = pdf.context.lookupMaybe(reference, PDFDict);
    const isLink = annotation?.lookupMaybe(PDFName.of('Subtype'), PDFName)?.asString() === '/Link';
    if (isLink && /passleader/i.test(annotationUri(annotation))) continue;
    kept.push(reference);
  }
  if (kept.size() > 0) page.node.set(PDFName.of('Annots'), kept);
  else page.node.delete(PDFName.of('Annots'));
}

function addUriLink(page, pdf, box, url) {
  const target = scaleBox(page, box);
  const annotation = pdf.context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: [target.x, target.y, target.x + target.width, target.y + target.height],
    Border: [0, 0, 0],
    A: { S: 'URI', URI: PDFString.of(url) },
  });
  const reference = pdf.context.register(annotation);
  let annotations = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  if (!annotations) {
    annotations = PDFArray.withContext(pdf.context);
    page.node.set(PDFName.of('Annots'), annotations);
  }
  annotations.push(reference);
}

function placeNativeLogo(page, logo, { x, top, width, height }) {
  const logoRatio = logo.width / logo.height;
  const boxRatio = width / height;
  const drawWidth = boxRatio > logoRatio ? height * logoRatio : width;
  const drawHeight = boxRatio > logoRatio ? height : width / logoRatio;
  page.drawImage(logo, { x: x + (width - drawWidth) / 2, y: page.getHeight() - top - height + (height - drawHeight) / 2, width: drawWidth, height: drawHeight });
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

function drawCenteredText(page, font, value, centerX, y, size, color) {
  page.drawText(value, { x: centerX - font.widthOfTextAtSize(value, size) / 2, y, size, font, color });
}

function drawFooter(page, pdf, font, websiteUrl, examCode) {
  const line = { x: 88, top: 733, width: 385, height: 20 };
  const urlBox = { x: 88, top: 757, width: 165, height: 19 };
  const placement = scaleBox(page, line);
  const textY = placement.y + (placement.height - 10) / 2;
  const prefix = 'Get Latest & Actual ';
  const suffix = " Exam's Question and Answers from Dump4Exam.";
  const blue = rgb(0, 0, 1);

  cover(page, line);
  page.drawText(prefix, { x: placement.x, y: textY, size: 10, font });
  const codeX = placement.x + font.widthOfTextAtSize(prefix, 10);
  const codeWidth = font.widthOfTextAtSize(examCode, 10);
  page.drawText(examCode, { x: codeX, y: textY, size: 10, font, color: blue });
  page.drawLine({ start: { x: codeX, y: textY - 1 }, end: { x: codeX + codeWidth, y: textY - 1 }, thickness: 0.5, color: blue });
  page.drawText(suffix, { x: codeX + codeWidth, y: textY, size: 10, font });

  replaceText(page, font, { ...urlBox, value: websiteUrl, size: 9, color: blue });
  const standardCodeX = line.x + font.widthOfTextAtSize(prefix, 10);
  addUriLink(page, pdf, { x: standardCodeX, top: line.top, width: codeWidth, height: line.height }, websiteUrl);
  addUriLink(page, pdf, urlBox, websiteUrl);
}

function drawIntroPage(page, pdf, logo, font, url, exam) {
  const { width, height } = page.getSize();
  const navy = rgb(0.06, 0.09, 0.15);
  const blue = rgb(0.08, 0.62, 0.86);
  const orange = rgb(1, 0.45, 0.05);
  page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(1, 1, 1) });
  page.drawRectangle({ x: 0, y: 0, width: 178, height, color: navy });
  page.drawCircle({ x: 54, y: height - 68, size: 29, color: blue, opacity: 0.35 });
  page.drawCircle({ x: 130, y: 65, size: 58, color: orange, opacity: 0.22 });
  page.drawRectangle({ x: 30, y: height - 190, width: 116, height: 132, color: rgb(1, 1, 1) });
  placeNativeLogo(page, logo, { x: 38, top: 67, width: 100, height: 114 });
  page.drawText('PREMIUM EXAM', { x: 30, y: height - 224, size: 12, font, color: rgb(1, 1, 1) });
  page.drawText('PREPARATION', { x: 30, y: height - 243, size: 12, font, color: rgb(1, 1, 1) });
  page.drawText('Built for focused practice', { x: 30, y: 95, size: 9, font, color: rgb(0.75, 0.84, 0.92) });
  page.drawText('and confident exam day.', { x: 30, y: 80, size: 9, font, color: rgb(0.75, 0.84, 0.92) });
  page.drawRectangle({ x: 222, y: height - 92, width: 62, height: 7, color: orange });
  page.drawRectangle({ x: 222, y: height - 106, width: 150, height: 4, color: blue });
  const titleLines = wrapText(font, exam.name, 18, 340);
  titleLines.forEach((line, index) => page.drawText(line, { x: 222, y: height - 164 - index * 25, size: 18, font, color: rgb(0.17, 0.2, 0.25) }));
  page.drawText(exam.code, { x: 222, y: height - 255, size: 42, font, color: navy });
  page.drawText('Your structured guide for practice questions,', { x: 222, y: height - 294, size: 11, font, color: rgb(0.35, 0.4, 0.47) });
  page.drawText('clear explanations, and steady progress.', { x: 222, y: height - 313, size: 11, font, color: rgb(0.35, 0.4, 0.47) });
  page.drawRectangle({ x: 222, y: 102, width: 300, height: 52, color: rgb(0.94, 0.97, 0.99) });
  page.drawText('Practice  •  Learn  •  Succeed', { x: 247, y: 121, size: 13, font, color: navy });
  page.drawText(url, { x: 222, y: 58, size: 9, font, color: blue });
  addUriLink(page, pdf, { x: 222, top: height - 70, width: 240, height: 18 }, url);
}

function drawAboutPage(page, pdf, logo, font, url, email) {
  const { width, height } = page.getSize();
  const navy = rgb(0.06, 0.09, 0.15);
  const blue = rgb(0.08, 0.62, 0.86);
  const orange = rgb(1, 0.45, 0.05);
  page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(1, 1, 1) });
  page.drawRectangle({ x: 0, y: height - 110, width, height: 110, color: navy });
  page.drawRectangle({ x: 38, y: height - 94, width: 86, height: 72, color: rgb(1, 1, 1) });
  placeNativeLogo(page, logo, { x: 45, top: 28, width: 72, height: 60 });
  page.drawText('ABOUT DUMP4EXAM', { x: 156, y: height - 67, size: 20, font, color: rgb(1, 1, 1) });
  page.drawRectangle({ x: 48, y: height - 150, width: 64, height: 6, color: orange });
  page.drawText('Study smarter. Build confidence. Be ready.', { x: 48, y: height - 190, size: 22, font, color: navy });
  page.drawText('Dump4Exam brings exam preparation into one focused space.', { x: 48, y: height - 223, size: 11, font, color: rgb(0.34, 0.39, 0.46) });
  page.drawText('Use practice material to identify gaps, learn from explanations,', { x: 48, y: height - 242, size: 11, font, color: rgb(0.34, 0.39, 0.46) });
  page.drawText('and progress toward exam day with clarity.', { x: 48, y: height - 261, size: 11, font, color: rgb(0.34, 0.39, 0.46) });
  const cards = [
    ['01', 'Practice', 'Work through focused', 'exam-style questions.'],
    ['02', 'Understand', 'Use explanations to', 'strengthen weak areas.'],
    ['03', 'Progress', 'Build momentum at', 'your own pace.'],
  ];
  cards.forEach(([number, title, lineOne, lineTwo], index) => {
    const x = 48 + index * 173;
    page.drawRectangle({ x, y: 177, width: 150, height: 116, color: rgb(0.95, 0.97, 0.99), borderColor: rgb(0.84, 0.9, 0.95), borderWidth: 0.6 });
    page.drawRectangle({ x, y: 272, width: 150, height: 21, color: index === 1 ? orange : blue });
    page.drawText(number, { x: x + 12, y: 278, size: 9, font, color: rgb(1, 1, 1) });
    page.drawText(title, { x: x + 12, y: 242, size: 13, font, color: navy });
    page.drawText(lineOne, { x: x + 12, y: 215, size: 9, font, color: rgb(0.34, 0.39, 0.46) });
    page.drawText(lineTwo, { x: x + 12, y: 200, size: 9, font, color: rgb(0.34, 0.39, 0.46) });
  });
  page.drawText(url, { x: 48, y: 86, size: 9, font, color: blue });
  page.drawText(email, { x: 48, y: 66, size: 9, font, color: blue });
  addUriLink(page, pdf, { x: 48, top: height - 98, width: 250, height: 17 }, url);
  addUriLink(page, pdf, { x: 48, top: height - 78, width: 250, height: 17 }, `mailto:${email}`);
}

function drawThankYouPage(page, pdf, logo, font, url, email) {
  const { width, height } = page.getSize();
  const navy = rgb(0.06, 0.09, 0.15);
  const blue = rgb(0.08, 0.62, 0.86);
  const orange = rgb(1, 0.45, 0.05);
  page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(1, 1, 1) });
  page.drawRectangle({ x: 0, y: 0, width: 82, height, color: navy });
  page.drawCircle({ x: 41, y: height - 105, size: 25, color: blue, opacity: 0.4 });
  page.drawCircle({ x: 41, y: 78, size: 36, color: orange, opacity: 0.35 });
  page.drawRectangle({ x: 245, y: height - 190, width: 122, height: 134, color: rgb(1, 1, 1) });
  placeNativeLogo(page, logo, { x: 255, top: 67, width: 102, height: 114 });
  drawCenteredText(page, font, 'THANK YOU', width / 2 + 38, height - 283, 35, navy);
  drawCenteredText(page, font, 'Best wishes for your exam.', width / 2 + 38, height - 322, 17, orange);
  drawCenteredText(page, font, 'You have put in the effort. Stay focused, trust your preparation,', width / 2 + 38, height - 372, 11, rgb(0.34, 0.39, 0.46));
  drawCenteredText(page, font, 'and take the next step with confidence.', width / 2 + 38, height - 393, 11, rgb(0.34, 0.39, 0.46));
  page.drawRectangle({ x: 151, y: height - 542, width: 348, height: 126, color: rgb(0.95, 0.97, 0.99) });
  ['Review key topics', 'Stay calm and focused', 'Believe in your progress'].forEach((label, index) => {
    const y = height - 459 - index * 32;
    page.drawCircle({ x: 184, y: y + 3, size: 7, color: index === 1 ? orange : blue });
    page.drawText(label, { x: 203, y, size: 12, font, color: navy });
  });
  drawCenteredText(page, font, 'Practice • Learn • Succeed', width / 2 + 38, 118, 15, navy);
  drawCenteredText(page, font, url, width / 2 + 38, 85, 9, blue);
  drawCenteredText(page, font, email, width / 2 + 38, 65, 9, blue);
  addUriLink(page, pdf, { x: 235, top: height - 98, width: 180, height: 16 }, url);
  addUriLink(page, pdf, { x: 235, top: height - 78, width: 180, height: 16 }, `mailto:${email}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return usage();
  if (args.error) return usage(args.error);

  const sourceBytes = await readFile(args.input);
  const exam = await detectExamDetails(sourceBytes, args.input);
  let pdf;
  let pages;
  let rasterized = false;

  async function rasterizeSource() {
    // PDF.js can render the source even when its page tree cannot be edited by
    // pdf-lib. @napi-rs/canvas keeps this fallback fully npm-based.
    globalThis.DOMMatrix ??= DOMMatrix;
    globalThis.ImageData ??= ImageData;
    globalThis.Path2D ??= Path2D;
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(sourceBytes),
      disableWorker: true,
      standardFontDataUrl: `${path.join(moduleDirectory, 'node_modules', 'pdfjs-dist', 'standard_fonts').replaceAll('\\', '/')}/`,
    });
    try {
      const sourcePdf = await loadingTask.promise;
      pdf = await PDFDocument.create();
      for (let pageNumber = 1; pageNumber <= sourcePdf.numPages; pageNumber += 1) {
        const sourcePage = await sourcePdf.getPage(pageNumber);
        const originalViewport = sourcePage.getViewport({ scale: 1 });
        const renderedViewport = sourcePage.getViewport({ scale: args.dpi / 72 });
        const canvas = createCanvas(Math.ceil(renderedViewport.width), Math.ceil(renderedViewport.height));
        await sourcePage.render({
          canvasContext: canvas.getContext('2d'),
          viewport: renderedViewport,
          background: 'white',
        }).promise;
        const image = await pdf.embedJpg(await canvas.encode('jpeg', args.jpegQuality));
        const page = pdf.addPage([originalViewport.width, originalViewport.height]);
        page.drawImage(image, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
      }
      pages = pdf.getPages();
      rasterized = true;
    } catch (error) {
      throw new Error(`Raster fallback failed: ${error.message}`);
    } finally {
      await loadingTask.destroy();
    }
  }

  async function loadEditableSource() {
    const source = sourceBytes;
    const originalWarn = console.warn;
    const load = async (bytes) => {
      // pdf-lib writes parser diagnostics through console.warn. We replace those
      // with one actionable error below instead of flooding the terminal.
      console.warn = () => {};
      pdf = await PDFDocument.load(bytes, {
        ignoreEncryption: args.ignoreEncryption,
        updateMetadata: false,
      });
      pages = pdf.getPages();
    };
    try {
      await load(source);
    } catch (firstError) {
      // QPDF repairs malformed cross-reference data and removes permissions
      // encryption. That lets pdf-lib overlay the logo without rasterizing the
      // rest of the document.
      const qpdf = await createQpdf({
        locateFile: (name) => path.join(moduleDirectory, 'node_modules', '@neslinesli93', 'qpdf-wasm', 'dist', name),
      });
      qpdf.FS.writeFile('/source.pdf', new Uint8Array(source));
      qpdf.callMain(['--decrypt', '/source.pdf', '/repaired.pdf']);
      await load(qpdf.FS.readFile('/repaired.pdf'));
    } finally {
      console.warn = originalWarn;
    }
  }

  if (args.rasterize) {
    await rasterizeSource();
  } else {
    try {
      await loadEditableSource();
    } catch (error) {
      console.warn('Vector editing is unavailable for this PDF; using the visual fallback.');
      try {
        await rasterizeSource();
      } catch (fallbackError) {
        throw new Error(
          `Cannot edit this PDF as vector content, and the visual fallback failed.\n${fallbackError.message}`,
        );
      }
    }
  }

  const logo = await embedLogo(pdf, args.logo);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pages.forEach((page, zeroBasedPage) => {
    const pageNumber = zeroBasedPage + 1;

    if (args.allPages || pageNumber >= 3) {
      cover(page, { x: 76, top: 0, width: 280, height: 64 });
      placeLogo(page, logo, { x: 116, top: 9, width: 195, height: 44 }, 0.27);
    }

    removePassLeaderLinks(page, pdf);

    if (pageNumber >= 3) {
      drawFooter(page, pdf, font, args.url, exam.code);
    }
  });

  if (pages[0]) drawIntroPage(pages[0], pdf, logo, font, args.url, exam);
  if (pages[1]) drawAboutPage(pages[1], pdf, logo, font, args.url, args.email);
  const lastContentPage = pages.at(-1);
  const thankYouPage = pdf.addPage([lastContentPage?.getWidth() ?? LETTER.width, lastContentPage?.getHeight() ?? LETTER.height]);
  drawThankYouPage(thankYouPage, pdf, logo, font, args.url, args.email);

  await mkdir(path.dirname(path.resolve(args.output)), { recursive: true });
  await writeFile(args.output, await pdf.save({ useObjectStreams: true }));
  console.log(`Wrote ${args.output} (${pdf.getPageCount()} pages${rasterized ? ', rasterized' : ''}; ${exam.code}: ${exam.name}).`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

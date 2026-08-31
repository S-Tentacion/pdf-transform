import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import createQpdf from '@neslinesli93/qpdf-wasm';
import { embedLogo } from './logo.js';

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

function drawFooter(page, pdf, font, websiteUrl) {
  const line = { x: 88, top: 733, width: 385, height: 20 };
  const urlBox = { x: 88, top: 757, width: 165, height: 19 };
  const placement = scaleBox(page, line);
  const textY = placement.y + (placement.height - 10) / 2;
  const prefix = 'Get Latest & Actual ';
  const examCode = 'PL-400';
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return usage();
  if (args.error) return usage(args.error);

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
      data: new Uint8Array(await readFile(args.input)),
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
    const source = await readFile(args.input);
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

    // Page 1 has a centered cover logo; the remaining question pages use a
    // larger header. Page 2 is a notice page with no header.
    if (pageNumber === 1) {
      cover(page, { x: 180, top: 112, width: 255, height: 72 });
      placeLogo(page, logo, { x: 204, top: 128, width: 205, height: 47 }, 0.27);
    } else if (args.allPages || pageNumber >= 3) {
      cover(page, { x: 76, top: 0, width: 280, height: 64 });
      placeLogo(page, logo, { x: 116, top: 9, width: 195, height: 44 }, 0.27);
    }

    removePassLeaderLinks(page, pdf);

    if (pageNumber >= 3) {
      drawFooter(page, pdf, font, args.url);
    }
  });

  // The notice page contains the only other fixed PassLeader reference.
  if (pages.length >= 2) {
    replaceText(pages[1], font, {
      x: 88, top: 373, width: 390, height: 21,
      value: `${args.email} and our technical experts will provide support in 24 hours.`, size: 10,
      color: rgb(0, 0, 1),
    });
  }

  await mkdir(path.dirname(path.resolve(args.output)), { recursive: true });
  await writeFile(args.output, await pdf.save({ useObjectStreams: true }));
  console.log(`Wrote ${args.output} (${pages.length} pages${rasterized ? ', rasterized' : ''}).`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

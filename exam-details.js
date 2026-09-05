import path from 'node:path';

function cleanText(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function fallbackName(inputPath) {
  return path.basename(inputPath, path.extname(inputPath)).replace(/[_-]+/g, ' ').trim();
}

function codeFrom(text, inputPath) {
  return text.match(/Exam\s*Code\s*:\s*([A-Z]{1,8}-\d{2,5})/i)?.[1]
    || text.match(/\b([A-Z]{1,8}-\d{2,5})\b/i)?.[1]
    || fallbackName(inputPath).match(/\b([A-Z]{1,8}-\d{2,5})\b/i)?.[1]
    || 'Exam';
}

function titleFrom(text, code, inputPath) {
  const labelled = text.match(/Exam\s*Name\s*:\s*([\s\S]{1,140}?)(?=\s+(?:Version|Exam\s*Code)\s*:|$)/i)?.[1];
  if (labelled) return cleanText(labelled);

  const codeIndex = text.toUpperCase().indexOf(code.toUpperCase());
  if (codeIndex >= 0) {
    const tail = text.slice(codeIndex + code.length).replace(/^[\s()\-:]+/, '');
    const candidate = tail.split(/\s+(?:Total|Questions|Link|Version|Question|Exam\s*Code)\s*:?[\s\S]*/i)[0];
    const title = cleanText(candidate);
    if (title.length >= 4 && title.length <= 110) return title;
  }
  return fallbackName(inputPath);
}

export async function detectExamDetails(sourceBytes, inputPath) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(sourceBytes), disableWorker: true });
  try {
    const source = await loadingTask.promise;
    const pageCount = Math.min(source.numPages, 5);
    const parts = [];
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await source.getPage(pageNumber);
      const content = await page.getTextContent();
      parts.push(content.items.map(item => item.str).join(' '));
    }
    const text = cleanText(parts.join(' '));
    const code = codeFrom(text, inputPath);
    return { code, name: titleFrom(text, code, inputPath) };
  } finally {
    await loadingTask.destroy();
  }
}

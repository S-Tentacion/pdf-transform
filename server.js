import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import express from 'express';
import multer from 'multer';

const execFileAsync = promisify(execFile);
const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 2 },
  fileFilter: (_request, file, done) => {
    const isPdf = file.fieldname === 'pdf' && file.mimetype === 'application/pdf';
    const isPng = file.fieldname === 'logo' && file.mimetype === 'image/png';
    done(isPdf || isPng ? null : new Error('Upload a PDF and a PNG logo only.'), isPdf || isPng);
  },
});
const appDirectory = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);

const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dump4Exam PDF transformer</title>
<style>body{font-family:Arial,sans-serif;max-width:720px;margin:64px auto;padding:0 20px;color:#151515}h1{margin-bottom:8px}form{display:grid;gap:16px;margin-top:28px;padding:24px;border:1px solid #ddd;border-radius:12px}label{display:grid;gap:7px;font-weight:700}input,button{font:inherit}button{background:#111;color:#fff;border:0;border-radius:7px;padding:11px 16px;cursor:pointer}button:disabled{opacity:.55;cursor:wait}#status{min-height:24px;color:#444}.note{color:#666;font-size:.92rem}</style>
</head><body><h1>Dump4Exam PDF transformer</h1><p>Choose a PDF and the Dump4Exam PNG. Your transformed PDF downloads automatically.</p>
<form id="form"><label>Source PDF<input name="pdf" type="file" accept="application/pdf,.pdf" required></label><label>Dump4Exam logo<input name="logo" type="file" accept="image/png,.png" required></label><button>Transform and download</button><div id="status" aria-live="polite"></div></form><p class="note">Files stay on this computer. The supplied 527-page PDF can take a few minutes.</p>
<script>
const form=document.querySelector('#form'),button=form.querySelector('button'),status=document.querySelector('#status');
form.addEventListener('submit',async event=>{event.preventDefault();button.disabled=true;status.textContent='Transforming - keep this tab open...';try{const response=await fetch('/transform',{method:'POST',body:new FormData(form)});if(!response.ok)throw new Error(await response.text());const blob=await response.blob(),url=URL.createObjectURL(blob),download=document.createElement('a'),source=form.elements.pdf.files[0];download.href=url;download.download=(source.name||'document.pdf').replace(/\\.pdf$/i,'')+'-Dump4Exam.pdf';download.click();URL.revokeObjectURL(url);status.textContent='Done - your download has started.'}catch(error){status.textContent='Error: '+error.message}finally{button.disabled=false}});
</script></body></html>`;

function outputName(fileName) {
  const safe = path.basename(fileName || 'document.pdf').replace(/[^a-z0-9._-]/gi, '_').replace(/\.pdf$/i, '');
  return `${safe || 'document'}-Dump4Exam.pdf`;
}

app.get('/', (_request, response) => response.type('html').send(page));

app.post('/transform', upload.fields([{ name: 'pdf', maxCount: 1 }, { name: 'logo', maxCount: 1 }]), async (request, response, next) => {
  let folder;
  try {
    const pdf = request.files?.pdf?.[0];
    const logo = request.files?.logo?.[0];
    if (!pdf || !logo) throw new Error('Select both a PDF and a PNG logo.');

    folder = await mkdtemp(path.join(tmpdir(), 'dump4exam-'));
    const input = path.join(folder, 'input.pdf');
    const logoPath = path.join(folder, 'logo.png');
    const output = path.join(folder, 'Dump4Exam.pdf');
    await Promise.all([writeFile(input, pdf.buffer), writeFile(logoPath, logo.buffer)]);

    const args = [path.join(appDirectory, 'transform.js'), '--input', input, '--logo', logoPath, '--output', output];
    await execFileAsync(process.execPath, args, { windowsHide: true, maxBuffer: 1024 * 1024 });

    response.download(output, outputName(pdf.originalname), async (error) => {
      await rm(folder, { recursive: true, force: true });
      if (error && !response.headersSent) next(error);
    });
  } catch (error) {
    if (folder) await rm(folder, { recursive: true, force: true });
    next(error);
  }
});

app.use((error, _request, response, _next) => {
  response.status(400).type('text').send(error.message || 'Transformation failed.');
});

app.listen(port, () => console.log(`Open http://localhost:${port}`));

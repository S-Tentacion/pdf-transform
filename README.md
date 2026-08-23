# pdf-transform

This Express + Node.js utility overlays the supplied `Dump4Exam` PNG where the fixed-layout
PassLeader branding appears. It uses QPDF WebAssembly to repair protected PDFs,
then preserves the rest of the document as vector content. The default coordinates are tuned for the supplied Letter-size
`PassLeader-400_Latest.pdf`:

- Cover logo on page 1
- Repeating header logo on pages 3 onward
- Repeating PassLeader footer name/URL on pages 3 onward
- The support email on the notice page (page 2)
- Removes PassLeader hyperlinks and makes the replacement URL/PL-400 link open `https://dump4exam.vercel.app/`

## Easiest way: browser download

Install the dependency once:

```powershell
npm install
```

Start the local app:

```powershell
npm start
```

Open `http://localhost:3000`, select the PDF, then choose **Transform and download**. The bundled
Dump4Exam logo is used automatically. Upload a replacement PNG only when the logo changes. The browser downloads the completed PDF
automatically. Nothing is uploaded to a remote server, and no Poppler setup is
needed. Both forms include editable website and support-email fields, defaulting
to `https://dump4exam.vercel.app/` and `Dump4Exam@gmail.com`.

## Command-line use

The CLI repairs the source with QPDF WebAssembly when necessary, then uses a
lossless `pdf-lib` overlay. This preserves source quality and keeps output size
close to the original. `--rasterize` is available only as a fallback for PDFs
that cannot be repaired.

```powershell
npm run transform -- `
  --input "C:\Users\princ\Downloads\PassLeader-400_Latest.pdf" `
  --url "https://dump4exam.vercel.app/" `
  --email "Dump4Exam@gmail.com" `
  --output ".\output\PL-400-Dump4Exam.pdf"
```

The fallback preserves the visual page appearance but makes source text
non-selectable and form fields non-interactive. It does not bypass passwords or
permissions.

Add `--logo "C:\path\to\replacement-logo.png"` only when you need to override the bundled Dump4Exam logo.

## Adjusting placement

The rectangles in `transform.js` use PDF points with `top` measured from the
top edge of a 612 x 792 Letter page. Tweak only the coordinate blocks in the
`pages.forEach` loop if a future PDF uses a different template. Add
`--all-pages` only when page 2 should also receive a header logo.

## CertyIQ to Dump4Exam

The local page now includes a second form for the supplied CertyIQ A5 exam-PDF layout. Upload
the CertyIQ PDF and a **Dump4Exam PNG logo**, then set the target website and support email.
It replaces the CertyIQ cover and information-page branding, including the original vendor
artwork and testimonial collage, with Dump4Exam placeholder panels. It also removes CertyIQ
hyperlinks and updates the title/closing-page links. The result remains a searchable vector PDF.

Use the form at `http://localhost:3000`, or run it directly:

```powershell
npm run transform:certyiq -- `
  --input "C:\path\to\CertIQ.pdf" `
  --logo "C:\path\to\Dump4Exam.png" `
  --url "https://dump4exam.vercel.app/" `
  --email "Dump4Exam@gmail.com" `
  --output ".\output\CertIQ-Dump4Exam.pdf"
```

## Important

Use the tool only for PDF material and branding that you are authorized to
modify. Keep the original PDF unchanged; the output is written to the path you
provide.

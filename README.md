# pdf-transform

This Express + Node.js utility overlays the supplied `Dump4Exam` PNG where the fixed-layout
PassLeader branding appears. It preserves the rest of a valid, unlocked PDF as
vector content. The default coordinates are tuned for the supplied Letter-size
`PassLeader-400_Latest.pdf`:

- Cover logo on page 1
- Repeating header logo on pages 3 onward
- Repeating PassLeader footer name/URL on pages 3 onward
- The support email on the notice page (page 2)

## Easiest way: browser download

Install the dependency once:

```powershell
npm install
```

Start the local app:

```powershell
npm start
```

Open `http://localhost:3000`, select the PDF and the Dump4Exam PNG, then choose
**Transform and download**. The browser downloads the completed PDF
automatically. Nothing is uploaded to a remote server, and no Poppler setup is
needed.

## Command-line use

The CLI tries the lossless `pdf-lib` overlay first. If it cannot parse the
source, it automatically uses PDF.js at 120 DPI with JPEG quality 65. This is
the compact default. Use `--dpi 180 --jpeg-quality 90` if you need the larger,
higher-quality version:

```powershell
npm run transform -- `
  --input "C:\Users\princ\Downloads\PassLeader-400_Latest.pdf" `
  --logo "C:\Users\princ\OneDrive\Pictures\Screenshots\Screenshot 2026-08-15 200914.png" `
  --output ".\output\PL-400-Dump4Exam.pdf"
```

The fallback preserves the visual page appearance but makes source text
non-selectable and form fields non-interactive. It does not bypass passwords or
permissions.

## Adjusting placement

The rectangles in `transform.js` use PDF points with `top` measured from the
top edge of a 612 x 792 Letter page. Tweak only the coordinate blocks in the
`pages.forEach` loop if a future PDF uses a different template. Add
`--all-pages` only when page 2 should also receive a header logo.

## Important

Use the tool only for PDF material and branding that you are authorized to
modify. Keep the original PDF unchanged; the output is written to the path you
provide.

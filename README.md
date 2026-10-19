# OpenCheck

**A free, privacy-first text similarity checker for students and researchers.**

OpenCheck compares a document with sources you choose and highlights overlapping
passages. Local-only checks run in your browser and do not send your draft to a
server. Optional external search and AI writing signals are separate, explicitly
opt-in features. The project is MIT-licensed and can be self-hosted without a
usage limit.

> **Scope matters:** OpenCheck does not have Turnitin's private document corpus,
> school/LMS integrations, instructor workflows, or full-text access to every
> publication. Search results cover the open metadata/abstracts returned by
> independent providers; they are not a comprehensive originality check. AI-writing
> signals are experimental and cannot establish authorship. A similarity score is
> a lead for human review, not a plagiarism verdict or proof of originality.

## What works today

- Paste text or extract text from `.txt`, `.md`, `.docx`, and selectable-text `.pdf`.
- Compare against documents or a folder in a private collection stored in the current
  browser (up to 3 MB; select at most 50 documents per import).
- Winnowing fingerprints over normalized word shingles, with matching passages,
  source attribution, and a transparent percentage based on matched document words.
- With a separate opt-in, search OpenAlex, Crossref, Europe PMC, Semantic Scholar,
  arXiv, and PubMed. Open web search is available through an optional, user-supplied
  Brave Search API key.
- See provider links and matching evidence from locally retrieved titles, abstracts,
  and search snippets. The report marks whether a match is based on a local document,
  abstract, snippet, or title only.
- Optionally request an experimental qualitative AI-writing signal through a
  user-supplied Gemini API key. The result has no probability score and is not
  evidence of authorship.
- Optionally exclude text after a `References`, `Bibliography`, `Works Cited`, or
  `Sources` heading.
- View a highlighted report and print or save it as PDF from the browser.
- Responsive light and dark themes, with no login or analytics integration.

Text tokenization supports many Unicode letters and numbers, but language-specific
word segmentation is not implemented; the interface and reference-heading recognition
are currently English. PDF extraction reads selectable
text; scanned images require OCR before they can be checked. Search providers return
metadata/abstracts and do not expose every paper's full text. Search checks at most
two short excerpts (up to 115 characters each) to limit text shared externally.
Browser storage is device/browser-specific, can be cleared by the user or browser,
and is not a backup.

## Run locally

Requirements: Node.js 20+ and npm.

```sh
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The first check can be tried
with **Try a sample**; this adds a clearly labeled sample document to the local
collection. Add your own sources from **My sources**.

To search scholarly indexes, enable the external-search option and review the
exact excerpts before consenting. To add general web results, enter a Brave Search
API key for that request. The optional AI-writing indicator needs a Gemini API key;
it is not saved, but both the checked text and key pass through the OpenCheck host
to Google when you explicitly consent and request an analysis. For sensitive work,
prefer local-only checks or a host you control.

Useful commands:

```sh
npm test
npm run typecheck
npm run lint
npm run build
npm start
```

## Self-host with Docker

```sh
docker compose up --build -d
```

Open [http://localhost:3000](http://localhost:3000). To stop the service, run
`docker compose down`. The application does not require a database or API keys for
local use. Academic search is available after explicit consent; optional Brave/Gemini
features need your own API keys. Browser-local documents stay in the browser used
to access the site; Docker does not persist or receive them.

For a public deployment, use HTTPS, keep the host and dependencies updated, and
review your reverse proxy's access logging and caching configuration. OpenCheck's
privacy guarantees concern document processing by this application; they do not
override browser extensions, endpoint monitoring, or a host operator's independent
network logs. A self-hosted operator should explain those boundaries to users.

## Privacy model

- A local-only check reads and compares the draft and source text in the browser.
- The local collection is held in that browser's `localStorage`; remove sources in
  **My sources** or clear site data to delete it.
- External scholarly/web search is off by default. After consent, up to two
  excerpts (each at most 115 characters) are sent to the OpenCheck host, which
  queries the listed providers. The complete draft is not sent for source search.
- Brave and Gemini API keys are held in page memory and are not written to
  `localStorage`. When used, the key is sent to the OpenCheck host; the host proxies
  requests to the corresponding provider. Use only a host you trust or self-host.
- An AI-writing review sends the checked text (up to 20,000 characters) through the
  OpenCheck host to Gemini after a separate consent and explicit request.
- No accounts, history database, analytics, or telemetry are configured.
- PDF and DOCX parsing libraries execute locally in the browser.
- Avoid adding confidential documents to a shared or public computer's browser.

## How the score is calculated

OpenCheck tokenizes text into case-folded Unicode words, forms consecutive
five-word shingles, and applies winnowing to shortlist candidate sources. It then
compares shared shingles to refine matched passages and word coverage. The overall
percentage is the number of unique submitted-text words covered by shared shingles
divided by its word count. A source's percentage is its covered words divided by
the same submitted-text word count.

The score is not a probability, an originality guarantee, or a judgment about
intent. Common phrases may overlap; paraphrases that do not share fingerprints
may be missed. External-source percentages measure overlap with the retrieved
title, abstract, or snippet only, not the complete publication. Search results can
be incomplete or rate-limited. Check highlighted context and cite sources
according to your institution's rules.

## Roadmap

Potential future work includes broader full-text coverage where licensing permits,
OCR for scanned PDFs, more interface languages, import/export of local collections,
optional user accounts/history, and instructor/LMS workflows. Any connector must
explain what text leaves the device and require explicit user consent. AI-writing
signals are not reliable authorship tests and must not be used as sole evidence.

## Contributing

Contributions are welcome. Please open an issue to discuss larger changes, keep
document processing local by default, add focused tests for detector changes, and
run `npm test`, `npm run typecheck`, and `npm run lint` before opening a pull
request. Do not submit real student papers, personal information, or copyrighted
corpus content as fixtures. The MIT license applies; contributors should ensure
they have the right to submit their changes.

## License

MIT. See [LICENSE](./LICENSE).

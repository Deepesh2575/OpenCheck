"use client";

import {
  ArrowDownToLine,
  ArrowRight,
  BookOpenText,
  Check,
  ChevronDown,
  CircleHelp,
  FileCheck2,
  FileText,
  FolderOpen,
  ExternalLink,
  Globe2,
  Info,
  LockKeyhole,
  Moon,
  Plus,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import {
  ChangeEvent,
  DragEvent,
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  compareWithCorpus,
  CorpusDocument,
  excludeReferences,
  SimilarityReport,
} from "@/lib/detection";
import { extractTextFromFile } from "@/lib/document";
import {
  extractSearchQueries,
  requestWritingStyleReview,
  SearchSource,
  searchExternalSources,
  WritingStyleReview,
} from "@/lib/search";

const CORPUS_STORAGE_KEY = "opencheck-local-corpus-v1";
const MAX_CORPUS_STORAGE_BYTES = 3 * 1024 * 1024;

const DEMO_SOURCE: CorpusDocument = {
  id: "opencheck-demo-source",
  title: "Demo source · example text",
  text:
    "A healthy ecosystem depends on the interactions between living organisms and their physical environment. " +
    "Biodiversity supports essential processes such as pollination, nutrient cycling, and the regulation of climate. " +
    "When habitats are fragmented, species may lose access to food, shelter, and suitable breeding grounds. " +
    "Conservation strategies can protect connected habitats and help communities adapt to environmental change.",
};
const DEMO_TEXT =
  "A healthy ecosystem depends on the interactions between living organisms and their physical environment. " +
  "Biodiversity supports essential processes such as pollination, nutrient cycling, and the regulation of climate. " +
  "When habitats are fragmented, species may lose access to food, shelter, and suitable breeding grounds. " +
  "Conservation strategies can protect connected habitats and help communities adapt to environmental change.";

function wordCount(text: string) {
  return text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

function highlightedText(
  text: string,
  ranges: Array<{ start: number; end: number }>,
  className: string,
) {
  const pieces: ReactNode[] = [];
  let cursor = 0;
  ranges.forEach((range, index) => {
    if (range.start > cursor) pieces.push(text.slice(cursor, range.start));
    pieces.push(
      <mark className={className} key={`${range.start}-${index}`}>
        {text.slice(range.start, range.end)}
      </mark>,
    );
    cursor = range.end;
  });
  if (cursor < text.length) pieces.push(text.slice(cursor));
  return pieces;
}

function getSavedCorpus(): CorpusDocument[] {
  try {
    const stored = localStorage.getItem(CORPUS_STORAGE_KEY);
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is CorpusDocument =>
        typeof item?.id === "string" &&
        typeof item?.title === "string" &&
        typeof item?.text === "string",
    );
  } catch (error) {
    console.error("Could not read the local corpus from this browser.", error);
    return [];
  }
}

export default function Home() {
  const [text, setText] = useState("");
  const [corpus, setCorpus] = useState<CorpusDocument[]>([]);
  const [corpusLoaded, setCorpusLoaded] = useState(false);
  const [report, setReport] = useState<SimilarityReport | null>(null);
  const [excludedReferences, setExcludedReferences] = useState(true);
  const [externalSearchEnabled, setExternalSearchEnabled] = useState(false);
  const [searchConsent, setSearchConsent] = useState(false);
  const [webSearchApiKey, setWebSearchApiKey] = useState("");
  const [externalSources, setExternalSources] = useState<CorpusDocument[]>([]);
  const [searchErrors, setSearchErrors] = useState<string[]>([]);
  const [aiReviewEnabled, setAiReviewEnabled] = useState(false);
  const [aiApiKey, setAiApiKey] = useState("");
  const [aiReview, setAiReview] = useState<WritingStyleReview | null>(null);
  const [isAiReviewing, setIsAiReviewing] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [error, setError] = useState("");
  const [isCorpusOpen, setIsCorpusOpen] = useState(false);
  const [isDark, setIsDark] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const corpusInput = useRef<HTMLInputElement>(null);
  const textWords = useMemo(() => wordCount(text), [text]);
  const checkedText = useMemo(
    () => (excludedReferences ? excludeReferences(text) : text),
    [excludedReferences, text],
  );
  const searchQueries = useMemo(() => extractSearchQueries(checkedText), [checkedText]);

  useEffect(() => {
    setCorpus(getSavedCorpus());
    setCorpusLoaded(true);
    try {
      setIsDark(localStorage.getItem("opencheck-theme") === "dark");
    } catch (cause) {
      console.error("Could not read the saved display preference.", cause);
      setError("This browser blocked local storage. Your theme preference cannot be saved.");
    }
  }, []);

  useEffect(() => {
    if (!corpusLoaded) return;
    try {
      const serialized = JSON.stringify(corpus);
      if (new Blob([serialized]).size > MAX_CORPUS_STORAGE_BYTES) {
        setError("Your local document collection is full. Remove a source before adding another.");
        return;
      }
      localStorage.setItem(CORPUS_STORAGE_KEY, serialized);
    } catch (cause) {
      console.error("Could not save the local corpus in this browser.", cause);
      setError("This browser could not save your local corpus. Check available site storage.");
    }
  }, [corpus, corpusLoaded]);

  useEffect(() => {
    document.documentElement.dataset.theme = isDark ? "dark" : "light";
    if (corpusLoaded) {
      try {
        localStorage.setItem("opencheck-theme", isDark ? "dark" : "light");
      } catch (cause) {
        console.error("Could not save the display preference.", cause);
      }
    }
  }, [isDark, corpusLoaded]);

  async function loadDocument(file: File) {
    setError("");
    setIsExtracting(true);
    try {
      const extracted = await extractTextFromFile(file);
      if (!extracted.trim()) {
        throw new Error("No selectable text was found. Scanned PDFs need OCR before checking.");
      }
      setText(extracted);
      setReport(null);
      setExternalSources([]);
      setSearchErrors([]);
      setSearchConsent(false);
      setAiReview(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read this document.");
    } finally {
      setIsExtracting(false);
    }
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) await loadDocument(file);
    event.target.value = "";
  }

  async function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (isChecking || isAiReviewing) return;
    const file = event.dataTransfer.files[0];
    if (file) await loadDocument(file);
  }

  async function addCorpusFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    event.target.removeAttribute("webkitdirectory");
    if (!files.length) return;
    setError("");
    setIsExtracting(true);
    try {
      if (files.length > 50) {
        throw new Error("Add at most 50 documents at a time.");
      }
      const supportedFiles = files.filter((file) =>
        /\.(txt|md|docx|pdf)$/i.test(file.name),
      );
      if (supportedFiles.length === 0) {
        throw new Error("No supported documents were selected. Choose .txt, .md, .docx, or .pdf files.");
      }
      const newDocuments = await Promise.all(
        supportedFiles.map(async (file) => ({
          id: crypto.randomUUID(),
          title: file.webkitRelativePath || file.name,
          text: await extractTextFromFile(file),
        })),
      );
      if (newDocuments.some((document) => !document.text.trim())) {
        throw new Error("At least one selected file did not contain readable text.");
      }
      const combined = [...corpus, ...newDocuments];
      if (new Blob([JSON.stringify(combined)]).size > MAX_CORPUS_STORAGE_BYTES) {
        throw new Error("These files exceed the 3 MB local collection limit. Add fewer or smaller files.");
      }
      setCorpus(combined);
      if (supportedFiles.length < files.length) {
        setError(`Added ${supportedFiles.length} documents; skipped ${files.length - supportedFiles.length} unsupported files.`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add the selected source files.");
    } finally {
      setIsExtracting(false);
    }
  }

  function selectCorpusFiles(folder = false) {
    const input = corpusInput.current;
    if (!input) return;
    if (folder) input.setAttribute("webkitdirectory", "");
    else input.removeAttribute("webkitdirectory");
    input.click();
  }

  async function runCheck(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setReport(null);
    setExternalSources([]);
    setSearchErrors([]);
    setSearchConsent(false);
    setAiReview(null);
    if (wordCount(checkedText) < 5) {
      setError("Add at least 5 words to run a meaningful check.");
      return;
    }
    if (externalSearchEnabled && searchQueries.length === 0) {
      setError("Add a complete sentence or at least 9 words to search external sources.");
      return;
    }
    if (externalSearchEnabled && !searchConsent) {
      setError("Confirm the external-search data-sharing notice before searching.");
      return;
    }

    setIsChecking(true);
    try {
      let searchedSources: CorpusDocument[] = [];
      if (externalSearchEnabled) {
        const result = await searchExternalSources(searchQueries, {
          webApiKey: webSearchApiKey,
        });
        searchedSources = result.sources.map((item: SearchSource) => ({
          id: item.id,
          title: item.title,
          text: item.text,
          url: item.url,
          provider: item.provider,
          published: item.published,
          evidenceType: item.evidenceType,
        }));
        setSearchErrors(result.errors);
        setExternalSources(searchedSources);
        if (searchedSources.length === 0 && result.errors.length > 0) {
          setError(`External search returned no sources. ${result.errors.join(" · ")}`);
        }
      }
      setReport(compareWithCorpus(checkedText, [...corpus, ...searchedSources]));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The check could not be completed.");
      setReport(compareWithCorpus(checkedText, corpus));
    } finally {
      setIsChecking(false);
    }
  }

  async function runStyleReview() {
    setError("");
    setAiReview(null);
    if (!aiReviewEnabled) {
      setError("Confirm the AI writing-style review data notice before continuing.");
      return;
    }
    if (!aiApiKey.trim()) {
      setError("Enter your Gemini API key to request a writing-style review.");
      return;
    }
    if (checkedText.length < 100) {
      setError("The AI writing-style review needs at least 100 characters.");
      return;
    }
    setIsAiReviewing(true);
    try {
      setAiReview(await requestWritingStyleReview(checkedText, aiApiKey.trim()));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The AI writing-style review failed.");
    } finally {
      setIsAiReviewing(false);
    }
  }

  function loadDemo() {
    setCorpus((current) =>
      current.some((source) => source.id === DEMO_SOURCE.id) ? current : [...current, DEMO_SOURCE],
    );
    setText(DEMO_TEXT);
    setReport(null);
    setExternalSources([]);
    setSearchConsent(false);
    setSearchErrors([]);
    setAiReview(null);
    setError("");
  }

  function startOver() {
    setText("");
    setReport(null);
    setExternalSources([]);
    setSearchConsent(false);
    setSearchErrors([]);
    setAiReview(null);
    setError("");
  }

  const score = Math.round(report?.overallPercent ?? 0);
  const totalComparedSources = corpus.length + externalSources.length;

  return (
    <main className="app-shell">
      <header className="topbar">
        <a aria-label="OpenCheck home" className="brand" href="#">
          <span aria-hidden="true" className="brand-mark">
            <ShieldCheck size={22} strokeWidth={2.1} />
          </span>
          <span>opencheck<span className="brand-period">.</span></span>
        </a>
        <div className="topbar-right">
          <div className="privacy-chip"><LockKeyhole size={14} /> Private by design</div>
          <button
            aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
            className="icon-button theme-toggle"
            onClick={() => setIsDark((current) => !current)}
            type="button"
          >
            {isDark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button className="corpus-button" disabled={isChecking || isAiReviewing} onClick={() => setIsCorpusOpen(true)} type="button">
            <FolderOpen size={17} />
            <span>My sources</span>
            <span className="corpus-count">{corpus.length}</span>
          </button>
        </div>
      </header>

      <section className="hero">
        <div className="eyebrow"><span className="eyebrow-dot" /> YOUR WORK. YOUR DEVICE. YOUR CALL.</div>
        <h1>Write with <span>confidence.</span></h1>
        <p className="hero-copy">
          Check your writing against your own private documents, right in your browser.
          External source search or AI review happens only if you choose it.
        </p>
        <div className="trust-row">
          <span><LockKeyhole size={15} /> Runs on your device</span>
          <span className="trust-divider" />
          <span><Check size={15} /> No account, unlimited local checks</span>
          <span className="trust-divider" />
          <span><Sparkles size={15} /> Free &amp; open source</span>
        </div>
      </section>

      <section className="workspace" aria-label="Document similarity checker">
        <div className="workspace-heading">
          <div>
            <div className="section-kicker">YOUR DOCUMENT</div>
            <h2>Start a new check</h2>
          </div>
          <button className="text-button demo-button" disabled={isChecking || isAiReviewing} onClick={loadDemo} type="button">
            <Sparkles size={15} /> Try a sample
          </button>
        </div>

        <form onSubmit={runCheck}>
          <div
            className={`input-card${dragging ? " is-dragging" : ""}`}
            onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={(event) => { event.preventDefault(); setDragging(false); }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleDrop}
          >
            <div className="input-card-top">
              <div className="input-label"><FileText size={16} /> Paste or type text</div>
              <button
                className="text-button upload-button"
                disabled={isExtracting || isChecking || isAiReviewing}
                onClick={() => fileInput.current?.click()}
                type="button"
              >
                <Upload size={15} /> {isExtracting ? "Reading file…" : "Upload a file"}
              </button>
              <input
                accept=".txt,.md,.docx,.pdf,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="visually-hidden"
                onChange={handleFileChange}
                ref={fileInput}
                type="file"
              />
            </div>
            <textarea
              aria-label="Text to check"
              disabled={isChecking || isAiReviewing}
              onChange={(event) => {
                setText(event.target.value);
                setReport(null);
                setExternalSources([]);
                setSearchErrors([]);
                setAiReview(null);
                setError("");
              }}
              placeholder={"Paste your essay or research paper here…\n\nLocal checks stay on this device. External services are used only if you separately opt in."}
              value={text}
            />
            <div className="input-card-bottom">
              <span>{textWords.toLocaleString()} words</span>
              <span className="drop-hint">or drop a .txt, .md, .docx, or .pdf</span>
            </div>
          </div>

          <div className="check-options">
            <label className="checkbox-label">
              <input
                checked={excludedReferences}
                disabled={isChecking || isAiReviewing}
                onChange={(event) => {
                  setExcludedReferences(event.target.checked);
                  setReport(null);
                  setExternalSources([]);
                  setSearchConsent(false);
                  setAiReview(null);
                }}
                type="checkbox"
              />
              <span className="custom-checkbox"><Check size={12} /></span>
              Exclude references section
              <span className="help-tip" title="Text after a References, Bibliography, Works Cited, or Sources heading is excluded.">
                <CircleHelp size={14} />
              </span>
            </label>
            <span className="local-target"><BookOpenText size={15} /> {corpus.length} local {corpus.length === 1 ? "source" : "sources"}</span>
          </div>

          <div className="external-search-card">
            <label className="checkbox-label">
              <input
                checked={externalSearchEnabled}
                disabled={isChecking || isAiReviewing}
                onChange={(event) => {
                  setExternalSearchEnabled(event.target.checked);
                  if (!event.target.checked) {
                    setSearchConsent(false);
                    setWebSearchApiKey("");
                  }
                  setReport(null);
                  setExternalSources([]);
                }}
                type="checkbox"
              />
              <span className="custom-checkbox"><Check size={12} /></span>
              <Globe2 size={15} />
              Also search academic indexes &amp; optional public web
            </label>
            {externalSearchEnabled && (
              <div className="external-search-options">
                <p>
                  Searches OpenAlex, Crossref, Europe PMC, Semantic Scholar, arXiv, and PubMed.
                  Up to two short excerpts from your text are sent to your OpenCheck host and those
                  providers. The complete draft is not sent. Results and abstracts can be incomplete.
                </p>
                {searchQueries.length > 0 ? (
                  <div className="query-preview">
                    {searchQueries.map((query, index) => (
                      <span key={`${index}-${query}`}>“{query}”</span>
                    ))}
                  </div>
                ) : (
                  <p className="query-warning">Add a complete sentence to generate search excerpts.</p>
                )}
                <details className="web-key-details">
                  <summary>Optional public-web search (Brave Search API key)</summary>
                  <label className="api-key-label" htmlFor="brave-api-key">Brave Search API key</label>
                  <input
                    autoComplete="off"
                    className="api-key-input"
                    id="brave-api-key"
                    onChange={(event) => setWebSearchApiKey(event.target.value)}
                    placeholder="Optional — academic search works without this"
                    type="password"
                    value={webSearchApiKey}
                  />
                  <small>
                    The key is held only in this page’s memory and sent to your OpenCheck host
                    to proxy Brave requests. Don’t use a key on a host you don’t trust.
                  </small>
                </details>
                <label className="external-consent">
                  <input
                    checked={searchConsent}
                    disabled={isChecking || isAiReviewing}
                    onChange={(event) => setSearchConsent(event.target.checked)}
                    type="checkbox"
                  />
                  <span>
                    I understand that the short excerpts shown above will be sent to the
                    listed academic providers through this OpenCheck host, and to Brave
                    Search if I enter a Brave API key.
                  </span>
                </label>
              </div>
            )}
          </div>

          {error && <div className="error-message" role="alert"><Info size={16} /> {error}</div>}

          <button
            className="check-button"
            disabled={isChecking || isAiReviewing || !text.trim() || (externalSearchEnabled && !searchConsent)}
            type="submit"
          >
            {isChecking ? (
              <><span className="spinner" /> {externalSearchEnabled ? "Searching sources…" : "Checking your document…"}</>
            ) : (
              <>{externalSearchEnabled ? "Search & check my writing" : "Check my writing"} <ArrowRight size={18} /></>
            )}
          </button>
          <p className="check-disclaimer">Local checks stay on this device. External searches are optional and require your consent.</p>
        </form>

        {report && (
          <section aria-live="polite" className="report-section" id="report">
            <div className="report-title-row">
              <div>
                <div className="section-kicker">YOUR RESULTS</div>
                <h2>Similarity report</h2>
              </div>
              <div className="report-actions">
                <button className="secondary-button" onClick={() => window.print()} type="button">
                  <ArrowDownToLine size={16} /> Save as PDF
                </button>
                <button aria-label="Start a new check" className="icon-button" onClick={startOver} type="button">
                  <RotateCcw size={17} />
                </button>
              </div>
            </div>

            <div className="report-summary">
              <div
                className={`score-ring${score > 0 ? " score-ring-matched" : ""}`}
                style={{ "--score-angle": `${score}%` } as CSSProperties}
              >
                <div><strong>{score}<small>%</small></strong><span>matched</span></div>
              </div>
              <div className="summary-copy">
                <h3>{score === 0 ? "No matches found in the checked sources" : "Some text matches the checked sources"}</h3>
                <p>
                  {report.wordCount.toLocaleString()} words checked against {totalComparedSources}{" "}
                  {totalComparedSources === 1 ? "source" : "sources"}.
                  {score > 0 && " Matching text is highlighted below."}
                </p>
                {totalComparedSources === 0 && (
                  <p className="summary-note">Add your own documents to <button className="inline-link" onClick={() => setIsCorpusOpen(true)} type="button">My sources</button> to compare against them.</p>
                )}
              </div>
            </div>

            <div className="score-explainer">
              <Info size={16} />
              <p>
                <strong>What this number means:</strong> the share of words in your text that overlap
                a checked document, abstract, or web snippet. External percentages are based only on
                the retrieved excerpt—not the complete source. A match is a prompt to review citations,
                not a verdict of plagiarism.
              </p>
            </div>

            {searchErrors.length > 0 && (
              <div className="provider-warnings">
                <Info size={15} />
                <span>Some providers could not be reached: {searchErrors.join(" · ")}</span>
              </div>
            )}
            {externalSearchEnabled && externalSources.length === 0 && searchErrors.length === 0 && (
              <div className="provider-warnings">
                <Info size={15} />
                <span>No records were returned by the external search providers. This check cannot establish originality.</span>
              </div>
            )}

            {externalSources.length > 0 && (
              <div className="external-results-card">
                <div className="subsection-heading">
                  <h3>External results reviewed</h3>
                  <span>{externalSources.length} results</span>
                </div>
                <div className="external-results-list">
                  {externalSources.slice(0, 12).map((source) => (
                    <div className="external-result-row" key={source.id}>
                      <span>{source.provider}</span>
                      <a href={source.url} rel="noreferrer" target="_blank">
                        {source.title} <ExternalLink aria-hidden="true" size={11} />
                      </a>
                      <small>
                        {source.evidenceType === "abstract"
                          ? "abstract"
                          : source.evidenceType === "snippet"
                            ? "web snippet"
                            : "title only"}
                        {source.published ? ` · ${source.published}` : ""}
                      </small>
                    </div>
                  ))}
                </div>
                {externalSources.length > 12 && (
                  <p className="external-results-more">
                    Showing the first 12 of {externalSources.length} returned results.
                  </p>
                )}
              </div>
            )}

            {report.matches.length > 0 ? (
              <div className="match-layout">
                <div className="match-list">
                  <div className="subsection-heading"><h3>Sources found</h3><span>{report.matches.length}</span></div>
                  {report.matches.map((match, index) => (
                    <div className="source-row" key={match.sourceId}>
                      <span className="source-index">{String(index + 1).padStart(2, "0")}</span>
                      <div className="source-info">
                        <strong title={match.sourceTitle}>
                          {match.sourceUrl ? (
                            <a href={match.sourceUrl} rel="noreferrer" target="_blank">
                              {match.sourceTitle} <ExternalLink aria-hidden="true" size={11} />
                            </a>
                          ) : match.sourceTitle}
                        </strong>
                        <span>
                          {match.sourceProvider ? `${match.sourceProvider} · ` : ""}
                          {match.evidenceType === "abstract"
                            ? "abstract excerpt"
                            : match.evidenceType === "snippet"
                              ? "web snippet"
                              : match.evidenceType === "title"
                                ? "title only"
                                : "local document"}
                          {" · "}{match.matchedWords} matching words
                        </span>
                      </div>
                      <span className="source-percent">{Math.round(match.percent)}%</span>
                    </div>
                  ))}
                </div>
                <div className="passage-card">
                  <div className="subsection-heading"><h3>Matched passages</h3></div>
                  {report.matches.flatMap((match) => match.passages.map((passage, index) => (
                    <div className="passage" key={`${match.sourceId}-${index}`}>
                      <div className="passage-source">
                        <span className="passage-dot" />
                        {match.sourceProvider ? `${match.sourceProvider} · ` : ""}
                        {match.sourceTitle}
                      </div>
                      <blockquote>{passage.text}</blockquote>
                    </div>
                  )))}
                </div>
              </div>
            ) : (
              <div className="empty-match">
                <FileCheck2 size={19} />
                <div><strong>No matching passages in the sources checked.</strong><span>This does not mean the text is original across the web or other publications.</span></div>
              </div>
            )}

            <section className="ai-review-card">
              <div className="ai-review-heading">
                <span className="feature-icon lilac"><Sparkles size={17} /></span>
                <div>
                  <h3>Experimental AI-writing indicator</h3>
                  <p>A weak, qualitative signal only—not a reliable detector, authorship proof, or basis for academic penalties.</p>
                </div>
              </div>
              <label className="api-key-label" htmlFor="gemini-api-key">Your Gemini API key</label>
              <input
                autoComplete="off"
                className="api-key-input"
                id="gemini-api-key"
                onChange={(event) => setAiApiKey(event.target.value)}
                placeholder="Used only for this request — not saved"
                type="password"
                value={aiApiKey}
              />
              <label className="external-consent">
                <input
                  checked={aiReviewEnabled}
                  onChange={(event) => {
                    setAiReviewEnabled(event.target.checked);
                    if (!event.target.checked) {
                      setAiApiKey("");
                      setAiReview(null);
                    }
                  }}
                  type="checkbox"
                />
                <span>
                  I consent to sending the checked text and my API key through this OpenCheck host
                  to Google Gemini for this style review.
                </span>
              </label>
              <button
                className="secondary-button ai-review-button"
                disabled={isAiReviewing || !aiReviewEnabled || !aiApiKey.trim()}
                onClick={runStyleReview}
                type="button"
              >
                {isAiReviewing ? <><span className="spinner spinner-dark" /> Reviewing…</> : <><Sparkles size={15} /> Review writing style</>}
              </button>
              {aiReview && (
                <div className="ai-review-result">
                  <strong>
                    {aiReview.assessment === "signals_observed"
                      ? "Some commonly discussed style patterns were observed"
                      : aiReview.assessment === "no_clear_signals"
                        ? "No clear style patterns were observed"
                        : "The result is inconclusive"}
                    {" — not authorship evidence"}
                  </strong>
                  <p>{aiReview.summary}</p>
                  {aiReview.signals.length > 0 && (
                    <ul>{aiReview.signals.map((signal, index) => <li key={index}>{signal}</li>)}</ul>
                  )}
                  <p className="ai-review-caveat">{aiReview.caveat}</p>
                </div>
              )}
            </section>

            <div className="checked-text">
              <div className="subsection-heading"><h3>Your text</h3><span>{report.wordCount.toLocaleString()} words</span></div>
              <p>{highlightedText(
                excludedReferences ? excludeReferences(text) : text,
                report.highlights,
                "text-highlight",
              )}</p>
            </div>
            <div className="report-footnote">
              <ShieldCheck size={16} />
              Your report is not stored by OpenCheck. External search and Gemini are separate, opt-in requests.
            </div>
          </section>
        )}
      </section>

      {!report && (
        <section className="how-section">
          <div className="section-kicker">A BETTER WAY TO CHECK</div>
          <h2>Useful, without the black box.</h2>
          <div className="feature-grid">
            <article className="feature-card">
              <span className="feature-icon green"><LockKeyhole size={19} /></span>
              <h3>Your work stays yours</h3>
              <p>Local-only checks never upload your draft. External search is optional and sends only short excerpts after you consent.</p>
            </article>
            <article className="feature-card">
              <span className="feature-icon lilac"><BookOpenText size={19} /></span>
              <h3>Check against your sources</h3>
              <p>Build a private collection of papers and notes. OpenCheck finds overlapping passages and shows its work.</p>
            </article>
            <article className="feature-card">
              <span className="feature-icon peach"><Sparkles size={19} /></span>
              <h3>Honest by design</h3>
              <p>A similarity score is a clue, not a judgment. We explain what matched—and what this check cannot tell you.</p>
            </article>
          </div>
          <div className="scope-note">
            <Info size={16} />
            <p><strong>Know the limits:</strong> academic search checks metadata and available abstracts, not every full-text paper. Public-web search needs your own Brave Search API key. Gemini’s optional AI-writing indicator is experimental and can be wrong; no automated score proves authorship. OpenCheck does not include Turnitin’s private corpus, institutional integrations, or instructor workflows.</p>
          </div>
        </section>
      )}

      <footer className="footer">
        <a className="footer-brand" href="#"><ShieldCheck size={17} /> opencheck<span>.</span></a>
        <span>Free forever. Open source. Yours to host.</span>
        <span>MIT licensed · Self-hostable</span>
      </footer>

      {isCorpusOpen && (
        <div
          aria-label="Manage local sources"
          aria-modal="true"
          className="modal-backdrop"
          onClick={(event) => { if (event.target === event.currentTarget) setIsCorpusOpen(false); }}
          role="dialog"
        >
          <div className="corpus-modal">
            <div className="modal-header">
              <div>
                <span className="section-kicker">PRIVATE TO THIS BROWSER</span>
                <h2>Your source collection</h2>
              </div>
              <button aria-label="Close source collection" className="icon-button" onClick={() => setIsCorpusOpen(false)} type="button"><X size={19} /></button>
            </div>
            <p className="modal-description">Add documents you have permission to use. They stay in this browser&apos;s local storage and are never uploaded.</p>
            <div className="source-picker-actions">
              <button className="add-source-button" disabled={isExtracting} onClick={() => selectCorpusFiles()} type="button">
              <Plus size={17} /> {isExtracting ? "Reading files…" : "Add documents"}
              </button>
              <button className="add-folder-button" disabled={isExtracting} onClick={() => selectCorpusFiles(true)} type="button">
                <FolderOpen size={16} /> Add a folder
              </button>
            </div>
            <input accept=".txt,.md,.docx,.pdf,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="visually-hidden" multiple onChange={addCorpusFiles} ref={corpusInput} type="file" />
            <p className="storage-note">Up to 3 MB total · 50 files per import · .txt, .md, .docx, and .pdf</p>
            <div className="corpus-list">
              {corpus.length === 0 ? (
                <div className="corpus-empty"><FolderOpen size={23} /><strong>No sources yet</strong><span>Add documents to compare your writing against.</span></div>
              ) : corpus.map((source) => (
                <div className="corpus-item" key={source.id}>
                  <span className="corpus-file-icon"><FileText size={17} /></span>
                  <div className="corpus-file-info"><strong title={source.title}>{source.title}</strong><span>{wordCount(source.text).toLocaleString()} words</span></div>
                  <button aria-label={`Remove ${source.title}`} className="icon-button remove-button" onClick={() => setCorpus((current) => current.filter((item) => item.id !== source.id))} type="button"><Trash2 size={16} /></button>
                </div>
              ))}
            </div>
            {corpus.length > 0 && (
              <button className="clear-sources" onClick={() => setCorpus([])} type="button">Remove all sources</button>
            )}
            <div className="modal-privacy"><LockKeyhole size={15} /> Stored only on this device. Clear browser site data to remove it.</div>
          </div>
        </div>
      )}

      <button aria-label="Back to top" className="back-top" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} type="button">
        <ChevronDown size={15} />
      </button>
    </main>
  );
}

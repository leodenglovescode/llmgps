import fs from 'fs';

let content = fs.readFileSync('src/components/llmgps-shell.tsx', 'utf-8');

// 1. Remove from proxy section
const debateToggleHTML = `
                      <div className="flex items-center justify-between mt-4">
                        <label className="text-sm font-medium">Debate Mode</label>
                        <button
                          type="button"
                          onClick={() => setDebateMode(!debateMode)}
                          className={cx("relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors focus:outline-none", debateMode ? "bg-[var(--foreground)]" : "bg-[var(--muted)]")}
                        >
                          <span className="sr-only">Toggle debate mode</span>
                          <span aria-hidden="true" className={cx("pointer-events-none absolute left-0 inline-block h-4 w-4 transform rounded-full bg-[var(--background)] shadow ring-0 transition-transform", debateMode ? "translate-x-4" : "translate-x-0")} />
                        </button>
                      </div>`;

content = content.replace(debateToggleHTML, '');

// 2. Insert into chat input bar
const gpsModeButtonHTML = `                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setGpsMode(!gpsMode)}
                      className={cx(
                        "text-xs px-2.5 py-1 rounded-full flex items-center gap-1.5 font-medium transition-colors border",
                         gpsMode ? "border-[var(--border)] bg-[var(--surface-subtle)] text-[var(--foreground)]" : "border-transparent text-[var(--muted)] hover:text-[var(--foreground)]"
                      )}
                    >
                      <span className={cx("w-1.5 h-1.5 rounded-full", gpsMode ? "bg-[var(--foreground)]" : "bg-[var(--muted)]")}></span>
                      GPS Mode
                    </button>`;

const replacementHTML = `                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setGpsMode(!gpsMode)}
                      className={cx(
                        "text-xs px-2.5 py-1 rounded-full flex items-center gap-1.5 font-medium transition-colors border",
                         gpsMode ? "border-[var(--border)] bg-[var(--surface-subtle)] text-[var(--foreground)]" : "border-transparent text-[var(--muted)] hover:text-[var(--foreground)]"
                      )}
                    >
                      <span className={cx("w-1.5 h-1.5 rounded-full", gpsMode ? "bg-[var(--foreground)]" : "bg-[var(--muted)]")}></span>
                      GPS Mode
                    </button>
                    {gpsMode && (
                      <button
                        type="button"
                        onClick={() => setDebateMode(!debateMode)}
                        className={cx(
                          "text-xs px-2.5 py-1 rounded-full flex items-center gap-1.5 font-medium transition-colors border",
                           debateMode ? "border-[var(--border)] bg-[var(--surface-subtle)] text-[var(--foreground)]" : "border-transparent text-[var(--muted)] hover:text-[var(--foreground)]"
                        )}
                        title="Cross-reference model answers before synthesizing"
                      >
                        <span className={cx("w-1.5 h-1.5 rounded-full", debateMode ? "bg-amber-500" : "bg-[var(--muted)]")}></span>
                        Debate Mode
                      </button>
                    )}`;

content = content.replace(gpsModeButtonHTML, replacementHTML);

fs.writeFileSync('src/components/llmgps-shell.tsx', content);
console.log('UI Relocated');

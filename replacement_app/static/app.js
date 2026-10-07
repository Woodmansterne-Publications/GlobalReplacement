const { useEffect, useMemo, useRef, useState } = React;

const NUMBER_FORMAT = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 3 });

function formatCount(value) {
  return finite_number(value) == null ? "—" : NUMBER_FORMAT.format(Number(value));
}

function finite_number(value) {
  return value == null || typeof value === "boolean" || String(value).trim() === "" || !Number.isFinite(Number(value)) ? null : Number(value);
}

function score_factors(breakdown = {}) {
  const target_price = finite_number(breakdown.target_rrp_gbp);
  const candidate_price = finite_number(breakdown.candidate_rrp_gbp);
  const rows = [
    ["Range", breakdown.range_factor, typeof breakdown.same_range === "boolean" ? breakdown.same_range : null],
    ["Shared tags", breakdown.tag_factor, Array.isArray(breakdown.shared_tags) ? breakdown.shared_tags.length > 0 : null],
    ["Price difference", breakdown.price_factor, target_price != null && candidate_price != null ? target_price === candidate_price : null],
  ];
  return rows.map(([label, value, match]) => ({
    label,
    tags: label === "Shared tags" && Array.isArray(breakdown.shared_tags) ? breakdown.shared_tags.join(", ") : "",
    text: finite_number(value) == null || match == null ? "Unavailable" : `×${formatCount(value)}`,
    tone: finite_number(value) == null || match == null ? "neutral" : match ? "positive" : "negative",
    comparison: match == null ? "Comparison unavailable" : match ? "Match" : "No match",
  }));
}

function rackTitle(example) {
  if (!example) return "Rack examples";
  return [example.display_type, example.display_ref || example.rack_code || example.account].filter(Boolean).join(" · ");
}

function rackDetails(example) {
  return [example.account && `Account ${example.account}`, example.revision && `Revision ${example.revision}`, example.rack_code && `Rack ${example.rack_code}`].filter(Boolean);
}

async function request(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      message = body.detail || body.message || message;
    } catch (_) {}
    throw new Error(message);
  }
  return response.json();
}

function Artwork({ item, label = "Card artwork", className = "" }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [item?.image_url]);
  return (
    <div className={`artwork ${className}`}>
      {item?.image_url && !failed ? (
        <img src={item.image_url} alt={`${label} for material ${item.material}`} onError={() => setFailed(true)} />
      ) : (
        <div className="artwork-fallback" role="img" aria-label={`Artwork unavailable for material ${item?.material || "unknown"}`}>
          <span aria-hidden="true">✳</span><small>Artwork unavailable</small>
        </div>
      )}
    </div>
  );
}

function Facts({ item }) {
  return (
    <dl className="facts">
      {item.design && item.design !== item.material && <div><dt>Design</dt><dd>{item.design}</dd></div>}
      <div><dt>Pockets</dt><dd>{formatCount(item.pocket_count)}</dd></div>
    </dl>
  );
}

function ScoreBreakdown({ breakdown }) {
  return (
    <dl className="score-list">
      {score_factors(breakdown || {}).map((row) => <div key={row.label} className={`factor-${row.tone}`}>
        <dt>{row.label}{row.tags && <span className="factor-positive"> [{row.tags}]</span>}<span className="sr-only"> · {row.comparison}</span></dt><dd>{row.text}</dd>
      </div>)}
    </dl>
  );
}

function AccountShowcase({ item, loading, displayAccount }) {
  const [expanded, set_expanded] = useState(false);
  const [query, set_query] = useState("");
  const accounts = item.accounts || [];
  const visible = expanded ? accounts.filter((account) => account.toLowerCase().includes(query.trim().toLowerCase())) : accounts.slice(0, 6);
  return <section className="account-showcase" aria-label="Accounts containing this material">
    <div className="panel-heading"><h3>Accounts <span className="muted">{formatCount(item.unique_accounts)}</span></h3>
      {accounts.length > 6 && <button type="button" className="text-button" aria-expanded={expanded} onClick={() => { set_expanded(!expanded); set_query(""); }}>{expanded ? "Show fewer" : "Show all"}</button>}</div>
    {expanded && <label className="search-field"><span className="sr-only">Filter accounts</span><input type="search" value={query} onChange={(event) => set_query(event.target.value)} placeholder="Find account" /></label>}
    {loading ? <p className="muted" role="status">Loading accounts…</p> : accounts.length ? <div className="account-list">
      {visible.map((account) => <span className={`account-chip ${account === displayAccount ? "account-active" : ""}`} key={account}>{account}</span>)}
      {!visible.length && <p className="muted">No accounts match this search.</p>}
    </div> : <p className="muted">Account details unavailable.</p>}
  </section>;
}

function ArtworkDialog({ item, onClose }) {
  const dialog_ref = useRef(null);
  useEffect(() => {
    const return_focus = document.activeElement;
    dialog_ref.current.showModal();
    return () => return_focus?.focus();
  }, []);
  return <dialog ref={dialog_ref} className="artwork-dialog" aria-labelledby="artwork-heading" onClose={onClose}>
    <div className="panel-heading"><h2 id="artwork-heading">Material {item.material}</h2>
      <button type="button" onClick={() => dialog_ref.current.close()} autoFocus>Close artwork</button></div>
    <Artwork item={item} />
  </dialog>;
}

function RackExample({ example, targetMaterial }) {
  const [selected_key, set_selected_key] = useState(null);
  const [board_size, set_board_size] = useState({ width: 0, height: 0 });
  const board_ref = useRef(null);
  const layout = useMemo(() => rack_neighbourhood(example?.slots, targetMaterial, selected_key),
    [example?.slots, targetMaterial, selected_key]);
  useEffect(() => {
    if (!board_ref.current) return;
    const observer = new ResizeObserver(([entry]) => set_board_size({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(board_ref.current);
    return () => observer.disconnect();
  }, [Boolean(layout)]);
  if (!layout) return <p className="empty-state">No positioned target pockets in this rack example.</p>;
  const scale = rack_scale(layout, board_size.width, board_size.height + 16);
  return (
    <>
      {layout.targets.length > 1 && <label className="rack-pocket-selector">Target pocket
        <select aria-label="Target pocket" value={pocket_key(layout.selected)} onChange={(event) => set_selected_key(event.target.value)}>
          {layout.targets.map((slot) => <option key={pocket_key(slot)} value={pocket_key(slot)}>Tier {slot.tier}, position {slot.position}</option>)}
        </select>
      </label>}
      <div ref={board_ref} className="rack-board" role="group" aria-label={`${rackTitle(example)} rack neighbourhood`}>
        <div className="rack-neighbourhood" style={{ gap: RACK_GAP_MM * scale, visibility: board_size.width ? "visible" : "hidden" }}>
          {layout.tiers.map((tier, row_index) => (
            <div className="rack-row" key={tier} style={{ gridTemplateColumns: layout.column_widths.map((width) => `${width * scale}px`).join(" "), gap: RACK_GAP_MM * scale }}>
              {layout.positions.map((position, column_index) => <RackPocket
                key={`${tier}:${position}`} slot={layout.cells[row_index][column_index]} tier={tier} position={position}
                height={layout.row_heights[row_index] * scale} scale={scale} selected_key={pocket_key(layout.selected)} />)}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function RackPocket({ slot, tier, position, height, scale, selected_key }) {
  const [failed, set_failed] = useState(false);
  useEffect(() => set_failed(false), [slot?.image_url]);
  const selected = slot && pocket_key(slot) === selected_key;
  return (
    <div className={`rack-slot ${slot?.is_target ? "rack-slot-target" : ""} ${selected ? "rack-slot-selected" : ""}`}>
      <span className="slot-label" title={`Tier ${tier}, position ${position}`}>T{tier} · P{position}</span>
      <div className="slot-space" style={{ height }}>
        {slot ? <div className="slot-image-frame" style={{ width: slot.width_mm * scale, height: slot.height_mm * scale }}>
          {slot.image_url && !failed ? <img src={slot.image_url} alt={`Material ${slot.material}, tier ${tier}, position ${position}`} onError={() => set_failed(true)} />
            : <span className="slot-art-missing" role="img" aria-label={`Artwork unavailable for material ${slot.material}`}>Artwork unavailable</span>}
        </div> : <span className="slot-art-missing">No pocket data</span>}
      </div>
      <div className="slot-details">
        <span className="slot-material">{slot?.material || "—"}</span>
        {slot?.is_target && <span className="target-marker">Target</span>}
        {selected && <span className="sr-only">Selected pocket</span>}
      </div>
    </div>
  );
}

function App() {
  const [search, setSearch] = useState("");
  const [targetPage, setTargetPage] = useState({ items: [], next_cursor: null });
  const [activeTarget, setActiveTarget] = useState(null);
  const [targetData, setTargetData] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [rackPage, setRackPage] = useState({ items: [], next_cursor: null, previous_cursor: null });
  const [candidateSearch, setCandidateSearch] = useState("");
  const [stagedChoice, setStagedChoice] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savedChoice, setSavedChoice] = useState(null);
  const [loadingTargets, setLoadingTargets] = useState(true);
  const [loadingTarget, setLoadingTarget] = useState(false);
  const [loadingRack, setLoadingRack] = useState(false);
  const [targetError, setTargetError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [rackError, setRackError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [artwork_item, set_artwork_item] = useState(null);
  const [save_message, set_save_message] = useState("");
  const active_material_ref = useRef(null);
  const search_ref = useRef(search);
  const saving_ref = useRef(false);
  const rack_request_ref = useRef(0);
  active_material_ref.current = activeTarget?.material;
  search_ref.current = search;

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoadingTargets(true);
      setTargetError("");
      try {
        const data = await request(`/api/targets?search=${encodeURIComponent(search.trim())}`);
        if (cancelled) return;
        setTargetPage(data);
        setActiveTarget((current) => saving_ref.current || data.items.some((item) => item.material === current?.material) ? current : data.items[0] || null);
      } catch (error) {
        if (!cancelled) setTargetError(error.message);
      } finally {
        if (!cancelled) setLoadingTargets(false);
      }
    }, search ? 220 : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [search]);

  useEffect(() => {
    rack_request_ref.current += 1;
    setStagedChoice(null); setSavedChoice(null); setSaveError(""); set_save_message(""); set_artwork_item(null); setCandidateSearch("");
    if (!activeTarget?.material) {
      setTargetData(null); setCandidates([]); setRackPage({ items: [], next_cursor: null, previous_cursor: null });
      setLoadingTarget(false); setLoadingRack(false); setDetailError(""); setRackError("");
      return;
    }
    let cancelled = false;
    setLoadingTarget(true); setLoadingRack(true);
    setDetailError(""); setRackError("");
    setTargetData(null); setCandidates([]);
    setRackPage({ items: [], next_cursor: null, previous_cursor: null });
    const material = encodeURIComponent(activeTarget.material);
    request(`/api/targets/${material}/candidates`).then((detail) => {
      if (cancelled) return;
      setTargetData(detail.target);
      setCandidates(detail.candidates || []);
      setSavedChoice(detail.Chosencandidate || null);
    }).catch((error) => {
      if (!cancelled) setDetailError(error.message);
    }).finally(() => { if (!cancelled) setLoadingTarget(false); });
    request(`/api/targets/${material}/rack-examples`).then((rack) => {
      if (!cancelled) setRackPage(rack);
    }).catch((error) => {
      if (!cancelled) setRackError(error.message);
    }).finally(() => { if (!cancelled) setLoadingRack(false); });
    return () => { cancelled = true; rack_request_ref.current += 1; };
  }, [activeTarget?.material]);

  async function loadRack(cursor) {
    if (!activeTarget?.material) return;
    const material = activeTarget.material;
    const request_id = ++rack_request_ref.current;
    const is_current = () => active_material_ref.current === material && rack_request_ref.current === request_id;
    setLoadingRack(true); setRackError("");
    try {
      const suffix = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
      const data = await request(`/api/targets/${encodeURIComponent(activeTarget.material)}/rack-examples${suffix}`);
      if (is_current()) setRackPage(data);
    } catch (error) {
      if (is_current()) setRackError(error.message);
    } finally { if (is_current()) setLoadingRack(false); }
  }

  async function loadMoreTargets() {
    if (!targetPage.next_cursor || loadingTargets) return;
    setLoadingTargets(true); setTargetError("");
    const query = search;
    try {
      const data = await request(`/api/targets?search=${encodeURIComponent(search.trim())}&cursor=${encodeURIComponent(targetPage.next_cursor)}`);
      if (search_ref.current === query) setTargetPage((page) => ({ ...data, items: [...page.items, ...data.items] }));
    } catch (error) { if (search_ref.current === query) setTargetError(error.message); }
    finally { if (search_ref.current === query) setLoadingTargets(false); }
  }

  async function saveChoice() {
    if (!activeTarget?.material || !stagedChoice || stagedChoice === savedChoice || saving_ref.current) return;
    const material = activeTarget.material;
    saving_ref.current = true;
    setSaving(true); setSaveError("");
    try {
      const data = await request(`/api/targets/${encodeURIComponent(activeTarget.material)}/choice`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidate_material: stagedChoice }),
      });
      setSavedChoice(data.Chosencandidate || stagedChoice);
      setTargetPage((page) => ({ ...page, items: page.items.map((item) => item.material === material ? { ...item, Chosencandidate: data.Chosencandidate || stagedChoice } : item) }));
      set_save_message(`Saved material ${data.Chosencandidate || stagedChoice}. This choice is shared across planners.`);
      setStagedChoice(null);
    } catch (error) { setSaveError(error.message); }
    finally { saving_ref.current = false; setSaving(false); }
  }

  const visibleCandidates = useMemo(() => {
    const needle = candidateSearch.trim().toLowerCase();
    if (!needle) return candidates;
    return candidates.filter((item) => [item.material, item.design].join(" ").toLowerCase().includes(needle));
  }, [candidateSearch, candidates]);
  const current_item = targetData || activeTarget;
  const example = rackPage.items[0];

  return (
    <div className="app-shell">
      <header className="masthead">
        <div className="brand-line"><img className="brand-logo" src="/assets/wm_logo.jpg" alt="Woodmansterne" /><h1>Global replacement</h1></div>
      </header>
      <main id="workspace" className="workspace-grid" tabIndex="-1">
        <section className="material-panel panel" aria-labelledby="material-heading">
          <div className="panel-heading"><h2 id="material-heading">Materials</h2><span className="muted">{targetPage.items.length} loaded</span></div>
          <label className="search-field"><span className="sr-only">Search target materials</span><input type="search" value={search} disabled={saving} onChange={(event) => setSearch(event.target.value)} placeholder="Material or design" /></label>
          <label className="compact-picker">Current material
            <select aria-label="Choose material" disabled={saving || !targetPage.items.length} value={activeTarget?.material || ""} onChange={(event) => setActiveTarget(targetPage.items.find((item) => item.material === event.target.value))}>
              {activeTarget && !targetPage.items.some((item) => item.material === activeTarget.material) && <option value={activeTarget.material}>{activeTarget.material}</option>}
              {targetPage.items.map((item) => <option key={item.material} value={item.material}>{item.material} · {formatCount(item.pocket_count)} pockets{item.design && item.design !== item.material ? ` · ${item.design}` : ""}{item.Chosencandidate ? " · Saved" : ""}</option>)}
            </select>
          </label>
          <div className="target-list" aria-label="Search results" aria-busy={loadingTargets}>
            {targetPage.items.map((item) => <button type="button" key={item.material} disabled={saving} className={`target-option ${activeTarget?.material === item.material ? "target-option-active" : ""}`} aria-pressed={activeTarget?.material === item.material} onClick={() => setActiveTarget(item)}>
              <span className="target-code">{item.material}</span>
              <span className="target-pockets">{formatCount(item.pocket_count)} pockets</span>
              {item.design && item.design !== item.material && <span className="target-name">Design {item.design}</span>}
              <span className="target-status">{item.Chosencandidate ? `Saved · ${item.Chosencandidate}` : "No choice saved"}</span>
            </button>)}
          </div>
          <div className="material-status" role="status">{loadingTargets && <p>Loading materials…</p>}
            {!loadingTargets && !targetError && !targetPage.items.length && <p>No materials found. Try another search.</p>}
            {targetPage.next_cursor && <button type="button" onClick={loadMoreTargets} disabled={loadingTargets || saving}>Load more targets</button>}
          </div>
          {targetError && <p className="error-banner" role="alert">Materials could not be loaded: {targetError}</p>}
        </section>
        <section className="context-panel panel" aria-labelledby="current-heading">
          {activeTarget ? <>
            <article className="current-card">
              <div><Artwork item={current_item} label="Current card" /><button type="button" className="text-button" onClick={() => set_artwork_item(current_item)}>View artwork<span className="sr-only"> for current material {activeTarget.material}</span></button></div>
              <div className="current-card-copy"><h2 id="current-heading">Current material</h2><strong className="material-code">{activeTarget.material}</strong><Facts item={current_item} /></div>
            </article>
            <AccountShowcase key={activeTarget.material} item={current_item} loading={loadingTarget} displayAccount={example?.account} />
            <section className="rack-wrap" aria-labelledby="rack-heading" aria-busy={loadingRack}>
              <div className="panel-heading"><h3 id="rack-heading">Display context</h3><div className="rack-nav">
                <button type="button" onClick={() => loadRack(rackPage.previous_cursor)} disabled={!rackPage.previous_cursor || loadingRack} aria-label="Previous rack example">←</button>
                <button type="button" onClick={() => loadRack(rackPage.next_cursor)} disabled={!rackPage.next_cursor || loadingRack} aria-label="Next rack example">→</button>
              </div></div>
              {example && <div className="rack-meta"><strong>{rackTitle(example)}</strong><span>{rackDetails(example).join(" · ")}</span></div>}
              {loadingRack && <p role="status">Loading display context…</p>}
              {!loadingRack && rackError && <p className="error-banner" role="alert">Display context could not be loaded: {rackError}</p>}
              {!loadingRack && !rackError && !example && <p className="empty-state">No active display examples for this material.</p>}
              {!loadingRack && example && <RackExample key={`${activeTarget.material}:${example.display_key}:${example.rack_code}`} example={example} targetMaterial={activeTarget.material} />}
              <p className="rack-caption">Nearby pockets in this rack. Gold marks the target; card sizes are approximate.</p>
            </section>
          </> : <><h2 id="current-heading">Current material</h2><p className="empty-state">Choose a material to review.</p></>}
        </section>
        <section className="candidate-panel panel" aria-labelledby="candidate-heading">
          <div className="panel-heading"><h2 id="candidate-heading">Ranked replacements</h2><span className="muted">{visibleCandidates.length} of {candidates.length}</span></div>
          <label className="search-field"><span className="sr-only">Filter candidate cards</span><input type="search" value={candidateSearch} onChange={(event) => setCandidateSearch(event.target.value)} placeholder="Filter by material or design" /></label>
          <div className="candidate-scroll" aria-busy={loadingTarget}>
            {loadingTarget && <p className="empty-state" role="status">Loading ranked replacements…</p>}
            {detailError && <p className="error-banner" role="alert">Replacements could not be loaded: {detailError}</p>}
            {!loadingTarget && !detailError && !candidates.length && <p className="empty-state">{activeTarget ? "No ranked replacements are available for this material." : "Choose a material to see replacements."}</p>}
            {!loadingTarget && !detailError && candidates.length > 0 && <div className="candidate-grid">
              {visibleCandidates.map((candidate) => {
                const selected = stagedChoice === candidate.material;
                const chosen = savedChoice === candidate.material;
                return <article className={`candidate-card ${selected ? "candidate-selected" : ""} ${chosen ? "candidate-saved" : ""}`} key={candidate.material}>
                  <div className="candidate-art-column">
                    <button type="button" className="candidate-art-select" disabled={saving} aria-label={`Select replacement ${candidate.material}`} aria-pressed={selected || chosen && !stagedChoice} onClick={() => { setStagedChoice(chosen ? null : candidate.material); setSaveError(""); set_save_message(""); }}>
                      <Artwork item={candidate} label="Candidate card" />
                    </button>
                    <button type="button" className="text-button artwork-button" onClick={() => set_artwork_item(candidate)}>View artwork<span className="sr-only"> for candidate material {candidate.material}</span></button>
                  </div>
                  <div className="candidate-copy">
                    <button type="button" className="candidate-select" disabled={saving} aria-pressed={selected || chosen && !stagedChoice} onClick={() => { setStagedChoice(chosen ? null : candidate.material); setSaveError(""); set_save_message(""); }}>
                      <span className="candidate-top"><span className="candidate-score"><small>Score</small><strong>{formatCount(candidate.score)}</strong></span><span className="candidate-rank">#{candidate.candidate_rank}</span></span>
                      <span className="candidate-identity"><strong>{candidate.material}</strong>{(selected || chosen) && <span className="choice-marker">{selected ? "Unsaved" : "Saved"}</span>}</span>
                      {candidate.design && candidate.design !== candidate.material && <span className="candidate-design">Design {candidate.design}</span>}
                      <span className="candidate-pockets">{formatCount(candidate.pocket_count ?? candidate.score_breakdown?.base_pocket_count)} pockets</span>
                    </button>
                    <ScoreBreakdown breakdown={candidate.score_breakdown} />
                  </div>
                </article>;
              })}
              {!visibleCandidates.length && <p className="empty-state">No replacements match “{candidateSearch}”. Clear the filter to see all candidates.</p>}
            </div>}
          </div>
          <footer className="save-bar">
            <div className="choice-summary" aria-live="polite"><span>Saved choice: <strong>{savedChoice || "None"}</strong></span>
              <span>{stagedChoice ? <>Unsaved selection: <strong>{stagedChoice}</strong></> : "Choices are shared across planners"}</span>
              {save_message && <span className="factor-positive">{save_message}</span>}
            </div>
            <div className="save-actions">{stagedChoice && <button type="button" disabled={saving} onClick={() => { setStagedChoice(null); setSaveError(""); }}>Cancel</button>}
              <button type="button" className="save-button" disabled={!stagedChoice || stagedChoice === savedChoice || saving || loadingTarget} onClick={saveChoice}>{saving ? "Saving…" : "Save choice"}</button></div>
            {saveError && <p className="save-error" role="alert">Save failed: {saveError}. Your selection is kept; try again.</p>}
          </footer>
        </section>
      </main>
      {artwork_item && <ArtworkDialog item={artwork_item} onClose={() => set_artwork_item(null)} />}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);

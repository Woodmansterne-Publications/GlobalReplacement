const { useEffect, useMemo, useRef, useState } = React;

const numberFormat = new Intl.NumberFormat("en-GB");
const SCORE_LABELS = {
  base_pocket_count: "Base pocket count",
  same_range: "Same range",
  range_factor: "Range factor",
  target_price_code: "Target price code",
  candidate_price_code: "Candidate price code",
  target_double_price_code: "Target double price code",
  candidate_double_price_code: "Candidate double price code",
  target_rrp_gbp: "Target RRP (£)",
  candidate_rrp_gbp: "Candidate RRP (£)",
  price_factor: "Price factor",
  shared_tags: "Shared tags",
  tag_factor: "Tag factor",
};

function formatCount(value) {
  return value == null || !Number.isFinite(Number(value)) ? "—" : numberFormat.format(Number(value));
}

function formatDate(value) {
  if (!value) return "Snapshot time unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Snapshot time unavailable" : `Snapshot · ${date.toLocaleString("en-GB")}`;
}

function isStale(value) {
  const timestamp = new Date(value || "").getTime();
  return Number.isFinite(timestamp) && Date.now() - timestamp > 24 * 60 * 60 * 1000;
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
      <div><dt>Design</dt><dd>{item.design || "—"}</dd></div>
      <div><dt>Publisher</dt><dd>{item.publisher || "—"}</dd></div>
      <div><dt>Pockets</dt><dd>{formatCount(item.pocket_count)}</dd></div>
      <div><dt>Accounts</dt><dd>{formatCount(item.unique_accounts)}</dd></div>
    </dl>
  );
}

function ScoreBreakdown({ breakdown }) {
  const entries = Object.entries(breakdown || {});
  return (
    <details className="score-details">
      <summary>Full score breakdown <span aria-hidden="true">＋</span></summary>
      {entries.length ? (
        <dl className="score-list">
          {entries.map(([key, value]) => (
            <div key={key}><dt>{SCORE_LABELS[key] || key.replaceAll("_", " ")}</dt><dd>{Array.isArray(value) ? value.join(", ") : value == null ? "—" : String(value)}</dd></div>
          ))}
        </dl>
      ) : <p className="muted small">No score details supplied for this candidate.</p>}
    </details>
  );
}

function RackExample({ example, targetMaterial }) {
  const [selected_key, set_selected_key] = useState(null);
  const [available_width, set_available_width] = useState(0);
  const board_ref = useRef(null);
  const layout = useMemo(() => rack_neighbourhood(example?.slots, targetMaterial, selected_key),
    [example?.slots, targetMaterial, selected_key]);
  useEffect(() => {
    if (!board_ref.current) return;
    const observer = new ResizeObserver(([entry]) => set_available_width(entry.contentRect.width));
    observer.observe(board_ref.current);
    return () => observer.disconnect();
  }, [Boolean(layout)]);
  if (!layout) return <p className="empty-state">No positioned target pockets in this rack example.</p>;
  const scale = rack_scale(layout, available_width);
  return (
    <>
      {layout.targets.length > 1 && <label className="rack-pocket-selector">Target pocket
        <select aria-label="Target pocket" value={pocket_key(layout.selected)} onChange={(event) => set_selected_key(event.target.value)}>
          {layout.targets.map((slot) => <option key={pocket_key(slot)} value={pocket_key(slot)}>Tier {slot.tier}, position {slot.position}</option>)}
        </select>
      </label>}
      <div ref={board_ref} className="rack-board" role="group" aria-label={`${rackTitle(example)} rack neighbourhood`}>
        <div className="rack-neighbourhood" style={{ gap: RACK_GAP_MM * scale, visibility: available_width ? "visible" : "hidden" }}>
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
        {selected && <span className="selected-pocket-marker">Selected pocket</span>}
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

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoadingTargets(true);
      setTargetError("");
      try {
        const data = await request(`/api/targets?search=${encodeURIComponent(search.trim())}`);
        if (cancelled) return;
        setTargetPage(data);
        const stillVisible = data.items.find((item) => item.material === activeTarget?.material);
        if (!stillVisible) setActiveTarget(data.items[0] || null);
      } catch (error) {
        if (!cancelled) setTargetError(error.message);
      } finally {
        if (!cancelled) setLoadingTargets(false);
      }
    }, search ? 220 : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [search]);

  useEffect(() => {
    if (!activeTarget?.material) {
      setTargetData(null); setCandidates([]); setRackPage({ items: [], next_cursor: null, previous_cursor: null });
      return;
    }
    let cancelled = false;
    setLoadingTarget(true); setLoadingRack(true);
    setDetailError(""); setRackError(""); setSaveError("");
    setTargetData(null); setCandidates([]); setSavedChoice(null);
    setRackPage({ items: [], next_cursor: null, previous_cursor: null });
    setStagedChoice(null); setSavedChoice(null); setCandidateSearch("");
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
    return () => { cancelled = true; };
  }, [activeTarget?.material]);

  async function loadRack(cursor) {
    if (!activeTarget?.material) return;
    setLoadingRack(true); setRackError("");
    try {
      const suffix = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
      const data = await request(`/api/targets/${encodeURIComponent(activeTarget.material)}/rack-examples${suffix}`);
      setRackPage(data);
    } catch (error) {
      setRackError(error.message);
    } finally { setLoadingRack(false); }
  }

  async function loadMoreTargets() {
    if (!targetPage.next_cursor || loadingTargets) return;
    setLoadingTargets(true); setTargetError("");
    try {
      const data = await request(`/api/targets?search=${encodeURIComponent(search.trim())}&cursor=${encodeURIComponent(targetPage.next_cursor)}`);
      setTargetPage((page) => ({ ...data, items: [...page.items, ...data.items] }));
    } catch (error) { setTargetError(error.message); }
    finally { setLoadingTargets(false); }
  }

  async function saveChoice() {
    if (!activeTarget?.material || !stagedChoice || saving) return;
    setSaving(true); setSaveError("");
    try {
      const data = await request(`/api/targets/${encodeURIComponent(activeTarget.material)}/choice`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidate_material: stagedChoice }),
      });
      setSavedChoice(data.Chosencandidate || stagedChoice);
      setStagedChoice(null);
    } catch (error) { setSaveError(error.message); }
    finally { setSaving(false); }
  }

  const visibleCandidates = useMemo(() => {
    const needle = candidateSearch.trim().toLowerCase();
    if (!needle) return candidates;
    return candidates.filter((item) => [item.material, item.design, item.publisher].join(" ").toLowerCase().includes(needle));
  }, [candidateSearch, candidates]);
  const snapshot = targetData?.snapshot_at || activeTarget?.snapshot_at;
  const chosenCandidate = savedChoice && candidates.find((item) => String(item.material) === String(savedChoice));

  return (
    <div className="app-shell" data-theme="dark">
      <div className="site-frame">
        <header className="masthead">
          <div>
            <div className="brand-line">
              <img className="brand-logo" src="/assets/wm_logo.jpg" alt="Woodmansterne" />
              <span className="brand-name">Woodmansterne</span><span className="brand-divider">/</span><span className="brand-product">Global replacement</span>
            </div>
            <p className="masthead-subtitle">Material review · ranked recommendations</p>
          </div>
          <div className={`data-stamp ${isStale(snapshot) ? "stamp-stale" : ""}`}><span className="status-dot"></span>{formatDate(snapshot)}{isStale(snapshot) && <b>Stale</b>}</div>
        </header>

        <main id="workspace" tabIndex="-1">
          <section className="page-intro">
            <div><span className="eyebrow">Range planning / 01</span><h1>Replacement review</h1><p>Compare current placement with ranked alternatives, then save one shared choice.</p></div>
            <div className="intro-mark" aria-hidden="true">01 <span>—</span> 10</div>
          </section>

          <div className="workspace-grid">
            <section className="context-panel" aria-labelledby="current-heading">
              <div className="panel-heading"><div><span className="eyebrow">Current material · rack context</span><h2 id="current-heading">Target in review</h2></div><span className="target-total">{targetPage.items.length || "—"} loaded</span></div>
              <label className="target-search"><span aria-hidden="true">⌕</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find material, design or publisher" aria-label="Search target materials" /></label>
              <div className="target-list" aria-label="Search results" aria-busy={loadingTargets}>
                {targetPage.items.map((item) => <button type="button" key={item.material} className={`target-option ${activeTarget?.material === item.material ? "target-option-active" : ""}`} aria-pressed={activeTarget?.material === item.material} onClick={() => setActiveTarget(item)}><span className="target-code">{item.material}</span><span className="target-name">{item.design || item.publisher || "Material"}</span></button>)}
                {loadingTargets && <p className="muted small">Loading targets…</p>}
                {!loadingTargets && !targetError && !targetPage.items.length && <p className="empty-state">No target materials found.</p>}
                {targetPage.next_cursor && <button className="text-button" type="button" onClick={loadMoreTargets} disabled={loadingTargets}>Load more targets</button>}
                {targetError && <p className="error-banner" role="alert">Targets could not be loaded: {targetError}</p>}
              </div>

              {activeTarget && <>
                <article className="current-card">
                  <div className="current-art-frame"><Artwork item={targetData || activeTarget} label="Current card" className="artwork-large" /><span className="image-caption">Current design</span></div>
                  <div className="current-card-copy"><div className="material-line"><span className="eyebrow">Material</span><span className="material-code">{activeTarget.material}</span></div><Facts item={targetData || activeTarget} /></div>
                </article>

                <section className="rack-wrap" aria-labelledby="rack-heading">
                  <div className="rack-heading"><div><span className="eyebrow">Physical placement</span><h3 id="rack-heading">{rackTitle(rackPage.items[0])}</h3></div>
                    <div className="rack-nav"><button type="button" onClick={() => loadRack(rackPage.previous_cursor)} disabled={!rackPage.previous_cursor || loadingRack} aria-label="Previous rack example">←</button><button type="button" onClick={() => loadRack(rackPage.next_cursor)} disabled={!rackPage.next_cursor || loadingRack} aria-label="Next rack example">→</button></div>
                  </div>
                  {rackPage.items.length > 0 && <div className="rack-meta"><span>{rackPage.items[0].display_type} display</span>{rackDetails(rackPage.items[0]).map((detail) => <span key={detail}>{detail}</span>)}</div>}
                  {loadingRack && <p className="muted small">Loading rack example…</p>}
                  {!loadingRack && rackError && <p className="error-banner" role="alert">Rack examples could not be loaded: {rackError}</p>}
                  {!loadingRack && !rackError && !rackPage.items.length && <p className="empty-state">No active rack examples for this material.</p>}
                  {!loadingRack && rackPage.items[0] && <RackExample key={`${activeTarget.material}:${rackPage.items[0].display_key}:${rackPage.items[0].rack_code}`} example={rackPage.items[0]} targetMaterial={activeTarget.material} />}
                  <p className="rack-caption">Up to 3 × 3 nearby pockets within this rack. Higher tiers appear above lower tiers. Card sizes are approximate; gold outlines mark the target.</p>
                </section>
              </>}
            </section>

            <section className="candidate-panel" aria-labelledby="candidate-heading">
              <div className="panel-heading candidate-heading-row"><div><span className="eyebrow">Ranked alternatives</span><h2 id="candidate-heading">Browse candidates</h2></div><span className="candidate-count">{candidates.length} <i>/</i> 10</span></div>
              <div className="saved-strip" aria-live="polite"><span className="saved-indicator"></span><div><small>Saved choice · Chosencandidate</small><strong>{savedChoice || "No choice saved"}</strong></div><span className="snapshot-label">{formatDate(snapshot)}</span></div>
              {isStale(snapshot) && <div className="notice-banner" role="status">This ranking snapshot is over 24 hours old. Ask an operator to refresh the data.</div>}
              {detailError && <div className="error-banner" role="alert">Candidate data could not be loaded: {detailError}</div>}
              <label className="candidate-search"><span aria-hidden="true">⌕</span><input type="search" value={candidateSearch} onChange={(event) => setCandidateSearch(event.target.value)} placeholder="Filter candidates by material or design" aria-label="Filter candidate cards" /></label>
              {loadingTarget && <div className="loading-state" role="status">Loading ranked candidates…</div>}
              {!loadingTarget && !detailError && candidates.length === 0 && <div className="empty-state">No ranked replacements are available for this material.</div>}
              {!loadingTarget && candidates.length > 0 && <div className="candidate-grid">
                {visibleCandidates.map((candidate) => {
                  const selected = String(stagedChoice) === String(candidate.material);
                  const chosen = String(savedChoice) === String(candidate.material);
                  return <article className={`candidate-card ${selected ? "candidate-selected" : ""}`} key={candidate.material}>
                    <button type="button" className="candidate-select" aria-pressed={selected} onClick={() => { setStagedChoice(candidate.material); setSaveError(""); }}>
                      <Artwork item={candidate} label="Candidate card" />
                      <span className="candidate-rank">Rank <b>{String(candidate.candidate_rank).padStart(2, "0")}</b></span>
                      <span className="candidate-material">{candidate.material}</span>
                      <span className="candidate-design">{candidate.design || "Design unavailable"}</span>
                      <span className="candidate-publisher">{candidate.publisher || "Publisher unavailable"}</span>
                      <span className="candidate-score">Score <b>{formatCount(candidate.score)}</b></span>
                      {chosen && <span className="chosen-pill">Saved choice</span>}
                      {selected && <span className="selected-pill">Staged</span>}
                    </button>
                    <ScoreBreakdown breakdown={candidate.score_breakdown} />
                  </article>;
                })}
                {!visibleCandidates.length && <p className="empty-state">No candidate materials match “{candidateSearch}”.</p>}
              </div>}
              {chosenCandidate && <p className="saved-note">Saved material {chosenCandidate.material} is in this ranked set.</p>}
              {stagedChoice && <div className="save-bar"><div><span className="eyebrow">Choice staged</span><strong>{stagedChoice}</strong>{saveError && <span className="save-error" role="alert">Save failed: {saveError} · Your staged choice is still here.</span>}</div><button type="button" className="save-button" onClick={saveChoice} disabled={saving}>{saving ? "Saving…" : "Save choice"}</button></div>}
            </section>
          </div>
        </main>
        <footer className="page-footer"><span>Global replacement · Planner workspace</span><span>Choices are shared across planners</span></footer>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);

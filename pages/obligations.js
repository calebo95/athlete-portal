import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/router";
import TopNav from "@/components/TopNav";
import Modal from "@/components/Modal";
import ui from "@/styles/ui.module.css";
import "@/styles/globals.css";

const OBLIGATION_TYPES = ["content", "race", "appearance", "invoice", "admin"];
const STATUS_OPTIONS = ["pending", "in_progress", "done", "skipped"];

function toISODateInput(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function ObligationsPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [workspaceId, setWorkspaceId] = useState(null);

  // data
  const [sponsors, setSponsors] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [obligations, setObligations] = useState([]);

  // UI
  const [msg, setMsg] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);

  // form
  const [title, setTitle] = useState("");
  const [type, setType] = useState("content");
  const [dueDate, setDueDate] = useState(toISODateInput(new Date()));
  const [status, setStatus] = useState("pending");
  const [sponsorId, setSponsorId] = useState("");
  const [contractId, setContractId] = useState("");

  // ---- auth bootstrap ----
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const u = data?.session?.user ?? null;
      setUser(u);
      if (!u) router.replace("/login");
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user ?? null;
      setUser(u);
      if (!u) router.replace("/login");
    });

    return () => sub.subscription.unsubscribe();
  }, [router]);

  async function loadWorkspaceId() {
    const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
    if (sessionErr) throw sessionErr;

    const u = sessionData?.session?.user;
    if (!u) return null;

    const { data, error } = await supabase
      .from("workspace_members")
      .select("workspace_id, created_at")
      .eq("user_id", u.id)
      .order("created_at", { ascending: true })
      .limit(1);

    if (error) throw error;
    return data?.[0]?.workspace_id ?? null;
  }

  // ---- loaders ----
  async function loadSponsors(wsId) {
    const { data, error } = await supabase
      .from("sponsors")
      .select("id,name")
      .eq("workspace_id", wsId)
      .order("name", { ascending: true });

    if (error) throw error;

    setSponsors(data || []);
    if (!sponsorId && data?.length) setSponsorId(data[0].id);
  }

  async function loadContracts(wsId) {
    const { data, error } = await supabase
      .from("contracts")
      .select("id,sponsor_id,start_date,end_date,created_at")
      .eq("workspace_id", wsId)
      .order("end_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });

    if (error) throw error;
    setContracts(data || []);
  }

  async function loadObligations(wsId) {
    let q = supabase
      .from("obligations")
      .select("id,title,type,due_date,status,notes,sponsor_id,contract_id,created_at")
      .eq("workspace_id", wsId)
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });

    if (!showAll) q = q.in("status", ["pending", "in_progress"]);

    const { data, error } = await q;
    if (error) throw error;

    setObligations(data || []);
  }

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        setMsg("");

        const wsId = await loadWorkspaceId();
        if (!wsId) {
          setWorkspaceId(null);
          setSponsors([]);
          setContracts([]);
          setObligations([]);
          setMsg("No workspace found for this user. Ask the owner to add you as a workspace member.");
          return;
        }

        setWorkspaceId(wsId);
        await loadSponsors(wsId);
        await loadContracts(wsId);
        await loadObligations(wsId);
      } catch (e) {
        setMsg(e.message || "Failed to load data.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, showAll]);

  // ---- keep contract selection sensible when sponsor changes ----
  const contractsForSelectedSponsor = useMemo(() => {
    if (!sponsorId) return contracts;
    return contracts.filter((c) => c.sponsor_id === sponsorId);
  }, [contracts, sponsorId]);

  useEffect(() => {
    if (!contractId) return;
    const stillValid = contractsForSelectedSponsor.some((c) => c.id === contractId);
    if (!stillValid) setContractId("");
  }, [contractId, contractsForSelectedSponsor]);

  // ---- derived helpers ----
  const sponsorNameById = useMemo(() => {
    const m = new Map();
    sponsors.forEach((s) => m.set(s.id, s.name));
    return m;
  }, [sponsors]);

  const contractLabelById = useMemo(() => {
    const m = new Map();
    contracts.forEach((c) => {
      const sponsorName = c.sponsor_id ? sponsorNameById.get(c.sponsor_id) : "";
      const start = c.start_date || "—";
      const end = c.end_date || "—";
      const label = sponsorName ? `${sponsorName}: ${start} → ${end}` : `${start} → ${end}`;
      m.set(c.id, label);
    });
    return m;
  }, [contracts, sponsorNameById]);

  const todayISO = useMemo(() => toISODateInput(new Date()), []);
  const overdueIds = useMemo(() => {
    const today = new Date(todayISO);
    return new Set(
      obligations
        .filter((o) => o.due_date && new Date(o.due_date) < today && o.status !== "done")
        .map((o) => o.id)
    );
  }, [obligations, todayISO]);

  // ---- modal helpers ----
  function resetFormDefaults() {
    setTitle("");
    setType("content");
    setDueDate(toISODateInput(new Date()));
    setStatus("pending");
    setContractId("");
    // keep sponsorId as-is
  }

  function openAddModal() {
    setMsg("");
    if (!sponsorId && sponsors?.length) setSponsorId(sponsors[0].id);
    resetFormDefaults();
    setShowAddModal(true);
  }

  function closeAddModal() {
    setShowAddModal(false);
  }

  // ---- actions ----
  async function addObligation(e) {
    e.preventDefault();
    setMsg("");

    if (!workspaceId) {
      setMsg("No workspace loaded. Cannot add obligation.");
      return;
    }

    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setMsg("Title is required.");
      return;
    }

    try {
      const payload = {
        workspace_id: workspaceId,
        title: cleanTitle,
        type,
        status,
        due_date: dueDate || null,
        sponsor_id: sponsorId || null,
        contract_id: contractId || null,
        notes: null,
      };

      const { error } = await supabase.from("obligations").insert(payload);
      if (error) throw error;

      resetFormDefaults();
      setShowAddModal(false);
      await loadObligations(workspaceId);
    } catch (e2) {
      setMsg(e2.message || "Failed to add obligation.");
    }
  }

  async function setObligationStatus(id, nextStatus) {
    setMsg("");
    try {
      const { error } = await supabase.from("obligations").update({ status: nextStatus }).eq("id", id);
      if (error) throw error;
      await loadObligations(workspaceId);
    } catch (e) {
      setMsg(e.message || "Failed to update status.");
    }
  }

  if (!user) return null;

  return (
    <div className={ui.container}>
      <TopNav active="obligations" />

      <div className={ui.header}>
        <div>
          <h1 className={ui.h1}>Obligations</h1>
          <div className={ui.sub}>Track deliverables, deadlines, and sponsor tasks.</div>
        </div>

        <div className={ui.actionsRow}>
          <button
            className={`${ui.btn} ${ui.btnPrimary}`}
            onClick={openAddModal}
            disabled={!workspaceId}
          >
            + Add obligation
          </button>

          <label className={`${ui.navLink} ${ui.pill}`}>
            <input
              className={ui.checkbox}
              type="checkbox"
              checked={showAll}
              onChange={(e) => setShowAll(e.target.checked)}
            />
            Show all
          </label>
        </div>
      </div>

      {msg ? <div className={ui.notice}>{msg}</div> : null}

      <Modal open={showAddModal} title="Add obligation" onClose={closeAddModal}>
        <form className={ui.form} onSubmit={addObligation}>
          <div className={ui.formGrid2}>
            <div className={ui.field}>
              <label className={ui.label}>Title</label>
              <input
                className={ui.input}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Nike IG post (Zegama), 3 frames"
                required
              />
            </div>

            <div className={ui.field}>
              <label className={ui.label}>Sponsor</label>
              <select
                className={ui.select}
                value={sponsorId}
                onChange={(e) => setSponsorId(e.target.value)}
                disabled={!sponsors.length || !workspaceId}
              >
                {sponsors.length ? null : <option value="">Add a sponsor first</option>}
                {sponsors.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
                <option value="">(No sponsor)</option>
              </select>
            </div>
          </div>

          <div className={ui.field}>
            <label className={ui.label}>Contract (optional)</label>
            <select
              className={ui.select}
              value={contractId}
              onChange={(e) => setContractId(e.target.value)}
              disabled={!workspaceId}
            >
              <option value="">(No contract)</option>
              {contractsForSelectedSponsor.map((c) => (
                <option key={c.id} value={c.id}>
                  {(c.start_date || "—") + " → " + (c.end_date || "—")}
                </option>
              ))}
            </select>
            <div className={ui.cardSub}>Tip: contracts are filtered by the selected sponsor.</div>
          </div>

          <div className={ui.formGrid3}>
            <div className={ui.field}>
              <label className={ui.label}>Type</label>
              <select className={ui.select} value={type} onChange={(e) => setType(e.target.value)}>
                {OBLIGATION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <div className={ui.field}>
              <label className={ui.label}>Due date</label>
              <input
                className={ui.input}
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>

            <div className={ui.field}>
              <label className={ui.label}>Status</label>
              <select className={ui.select} value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className={ui.formActions}>
            <button type="button" className={ui.btn} onClick={closeAddModal}>
              Cancel
            </button>
            <button type="submit" className={`${ui.btn} ${ui.btnPrimary}`} disabled={!workspaceId}>
              Add obligation
            </button>
          </div>
        </form>
      </Modal>

      <div className={ui.grid}>
        <div className={`${ui.card} ${ui.span2}`}>
          <div className={ui.cardHeader}>
            <div>
              <h2 className={ui.h2}>List</h2>
              <div className={ui.cardSub}>
                {showAll ? "Showing all statuses." : "Showing pending / in progress only."}
              </div>
            </div>
          </div>

          <div className={ui.cardBody}>
            {obligations.length === 0 ? (
              <div className={ui.item}>
                <div>
                  <div className={ui.itemTitle}>No obligations yet.</div>
                  <div className={ui.itemMeta}>Click “Add obligation” to create one.</div>
                </div>
              </div>
            ) : (
              obligations.map((o) => {
                const sponsorName = o.sponsor_id ? sponsorNameById.get(o.sponsor_id) : null;
                const contractLabel = o.contract_id ? contractLabelById.get(o.contract_id) : null;
                const isOverdue = overdueIds.has(o.id);

                return (
                  <div key={o.id} className={ui.item}>
                    <div>
                      <div className={ui.itemTitle}>
                        {o.title}
                        {isOverdue ? " — OVERDUE" : ""}
                      </div>
                      <div className={ui.itemMeta}>
                        {sponsorName ? `${sponsorName} • ` : ""}
                        {o.type} • {o.status}
                        {o.due_date ? ` • due ${o.due_date}` : ""}
                        {contractLabel ? ` • contract: ${contractLabel}` : ""}
                      </div>
                    </div>

                    <div className={ui.actionsRow}>
                      {o.status !== "done" ? (
                        <button className={ui.btn} onClick={() => setObligationStatus(o.id, "done")}>
                          Mark done
                        </button>
                      ) : (
                        <button className={ui.btn} onClick={() => setObligationStatus(o.id, "pending")}>
                          Reopen
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

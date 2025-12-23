import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/router";
import TopNav from "@/components/TopNav";
import Modal from "@/components/Modal";
import ui from "@/styles/ui.module.css";
import "@/styles/globals.css";

function toISODateInput(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function ContractsPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [workspaceId, setWorkspaceId] = useState(null);

  // UI
  const [msg, setMsg] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);

  // data
  const [sponsors, setSponsors] = useState([]);
  const [contracts, setContracts] = useState([]);

  // form
  const [sponsorId, setSponsorId] = useState("");
  const [startDate, setStartDate] = useState(toISODateInput(new Date()));
  const [endDate, setEndDate] = useState("");
  const [basePay, setBasePay] = useState("");
  const [notes, setNotes] = useState("");

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

  // ---- derived helpers ----
  const sponsorNameById = useMemo(() => {
    const m = new Map();
    sponsors.forEach((s) => m.set(s.id, s.name));
    return m;
  }, [sponsors]);

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
      .select("id,sponsor_id,start_date,end_date,base_pay,notes,created_at")
      .eq("workspace_id", wsId)
      .order("end_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });

    if (error) throw error;
    setContracts(data || []);
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
          setMsg("No workspace found for this user. Ask the owner to add you as a workspace member.");
          return;
        }

        setWorkspaceId(wsId);
        await loadSponsors(wsId);
        await loadContracts(wsId);
      } catch (e) {
        setMsg(e.message || "Failed to load contracts.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // ---- modal helpers ----
  function resetFormDefaults() {
    setStartDate(toISODateInput(new Date()));
    setEndDate("");
    setBasePay("");
    setNotes("");
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
  async function addContract(e) {
    e.preventDefault();
    setMsg("");

    if (!workspaceId) {
      setMsg("No workspace loaded. Cannot add contract.");
      return;
    }
    if (!sponsorId) {
      setMsg("Please add/select a sponsor first.");
      return;
    }

    const payload = {
      workspace_id: workspaceId,
      sponsor_id: sponsorId,
      start_date: startDate || null,
      end_date: endDate || null,
      base_pay: basePay ? Number(basePay) : null,
      notes: notes.trim() || null,
    };

    const { error } = await supabase.from("contracts").insert(payload);
    if (error) {
      setMsg(error.message);
      return;
    }

    resetFormDefaults();
    setShowAddModal(false);
    await loadContracts(workspaceId);
  }

  async function deleteContract(id) {
    setMsg("");
    const ok = confirm("Delete this contract?");
    if (!ok) return;

    const { error } = await supabase.from("contracts").delete().eq("id", id);
    if (error) setMsg(error.message);
    else loadContracts(workspaceId);
  }

  if (!user) return null;

  return (
    <div className={ui.container}>
      <TopNav active="contracts" />

      <div className={ui.header}>
        <div>
          <h1 className={ui.h1}>Contracts</h1>
          <div className={ui.sub}>Track sponsor agreements, terms, and base pay.</div>
        </div>

        <div className={ui.actionsRow}>
          <button className={`${ui.btn} ${ui.btnPrimary}`} onClick={openAddModal} disabled={!workspaceId}>
            + Add contract
          </button>
        </div>
      </div>

      {msg ? <div className={ui.notice}>{msg}</div> : null}

      <Modal open={showAddModal} title="Add contract" onClose={closeAddModal}>
        <form className={ui.form} onSubmit={addContract}>
          <div className={ui.field}>
            <label className={ui.label}>Sponsor</label>
            <select
              className={ui.select}
              value={sponsorId}
              onChange={(e) => setSponsorId(e.target.value)}
              disabled={!sponsors.length || !workspaceId}
              required
            >
              {sponsors.length ? null : <option value="">Add a sponsor first</option>}
              {sponsors.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className={ui.formGrid2}>
            <div className={ui.field}>
              <label className={ui.label}>Start date</label>
              <input
                className={ui.input}
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>

            <div className={ui.field}>
              <label className={ui.label}>End date</label>
              <input className={ui.input} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>

          <div className={ui.field}>
            <label className={ui.label}>Base pay (optional)</label>
            <input
              className={ui.input}
              type="number"
              step="0.01"
              value={basePay}
              onChange={(e) => setBasePay(e.target.value)}
              placeholder="e.g., 50000"
            />
          </div>

          <div className={ui.field}>
            <label className={ui.label}>Notes (optional)</label>
            <textarea
              className={ui.textarea}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Deliverables, bonus triggers, usage rights, renewal notes…"
            />
          </div>

          <div className={ui.formActions}>
            <button type="button" className={ui.btn} onClick={closeAddModal}>
              Cancel
            </button>
            <button type="submit" className={`${ui.btn} ${ui.btnPrimary}`} disabled={!workspaceId}>
              Add contract
            </button>
          </div>
        </form>
      </Modal>

      <div className={ui.grid}>
        <div className={`${ui.card} ${ui.span2}`}>
          <div className={ui.cardHeader}>
            <div>
              <h2 className={ui.h2}>List</h2>
              <div className={ui.cardSub}>{contracts.length ? `${contracts.length} contract(s)` : "No contracts yet."}</div>
            </div>
          </div>

          <div className={ui.cardBody}>
            {contracts.length === 0 ? (
              <div className={ui.item}>
                <div>
                  <div className={ui.itemTitle}>No contracts yet.</div>
                  <div className={ui.itemMeta}>Click “Add contract” to create one.</div>
                </div>
              </div>
            ) : (
              contracts.map((c) => {
                const sponsor = c.sponsor_id ? sponsorNameById.get(c.sponsor_id) : "Unknown sponsor";
                return (
                  <div key={c.id} className={ui.item}>
                    <div>
                      <div className={ui.itemTitle}>{sponsor}</div>
                      <div className={ui.itemMeta}>
                        {c.start_date ? `start ${c.start_date}` : "start —"} • {c.end_date ? `end ${c.end_date}` : "end —"}
                        {c.base_pay ? ` • base $${Number(c.base_pay).toFixed(2)}` : ""}
                      </div>
                      {c.notes ? <div className={ui.itemMeta}>{c.notes}</div> : null}
                    </div>

                    <div className={ui.actionsRow}>
                      <button className={ui.btn} onClick={() => deleteContract(c.id)}>
                        Delete
                      </button>
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

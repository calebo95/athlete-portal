import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/router";
import TopNav from "@/components/TopNav";
import Modal from "@/components/Modal";
import ui from "@/styles/ui.module.css";
import "@/styles/globals.css";

const STATUS_OPTIONS = ["draft", "sent", "paid", "void"];

function toISODateInput(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function InvoicesPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [workspaceId, setWorkspaceId] = useState(null);

  // data
  const [sponsors, setSponsors] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [invoices, setInvoices] = useState([]);

  // UI
  const [msg, setMsg] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);

  // form
  const [sponsorId, setSponsorId] = useState("");
  const [contractId, setContractId] = useState("");
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState("draft");
  const [sentDate, setSentDate] = useState("");
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

  async function loadInvoices(wsId) {
    let q = supabase
      .from("invoices")
      .select("id,amount,status,sent_date,paid_date,notes,sponsor_id,contract_id,created_at")
      .eq("workspace_id", wsId)
      .order("created_at", { ascending: false });

    if (!showAll) q = q.in("status", ["draft", "sent"]);

    const { data, error } = await q;
    if (error) throw error;
    setInvoices(data || []);
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
          setInvoices([]);
          setMsg("No workspace found for this user. Ask the owner to add you as a workspace member.");
          return;
        }

        setWorkspaceId(wsId);
        await loadSponsors(wsId);
        await loadContracts(wsId);
        await loadInvoices(wsId);
      } catch (e) {
        setMsg(e.message || "Failed to load invoices.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, showAll]);

  // ---- derived helpers ----
  const sponsorNameById = useMemo(() => {
    const m = new Map();
    sponsors.forEach((s) => m.set(s.id, s.name));
    return m;
  }, [sponsors]);

  const contractsForSelectedSponsor = useMemo(() => {
    if (!sponsorId) return contracts;
    return contracts.filter((c) => c.sponsor_id === sponsorId);
  }, [contracts, sponsorId]);

  useEffect(() => {
    if (!contractId) return;
    const ok = contractsForSelectedSponsor.some((c) => c.id === contractId);
    if (!ok) setContractId("");
  }, [contractId, contractsForSelectedSponsor]);

  // ---- modal helpers ----
  function resetFormDefaults() {
    setAmount("");
    setStatus("draft");
    setSentDate("");
    setNotes("");
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
  async function addInvoice(e) {
    e.preventDefault();
    setMsg("");

    if (!workspaceId) {
      setMsg("No workspace loaded. Cannot add invoice.");
      return;
    }

    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setMsg("Amount must be a positive number.");
      return;
    }

    const effectiveSentDate = status === "sent" && !sentDate ? toISODateInput(new Date()) : sentDate || null;
    const paidDate = status === "paid" ? toISODateInput(new Date()) : null;

    try {
      const payload = {
        workspace_id: workspaceId,
        sponsor_id: sponsorId || null,
        contract_id: contractId || null,
        amount: amt,
        status,
        sent_date: effectiveSentDate,
        paid_date: paidDate,
        created_by: user.id,
        notes: notes.trim() || null,
      };

      const { error } = await supabase.from("invoices").insert(payload);
      if (error) throw error;

      resetFormDefaults();
      setShowAddModal(false);
      await loadInvoices(workspaceId);
    } catch (e2) {
      setMsg(e2.message || "Failed to add invoice.");
    }
  }

  async function updateInvoiceStatus(id, nextStatus) {
    setMsg("");
    try {
      const patch = { status: nextStatus };

      if (nextStatus === "sent") patch.sent_date = toISODateInput(new Date());
      if (nextStatus === "paid") patch.paid_date = toISODateInput(new Date());

      const { error } = await supabase.from("invoices").update(patch).eq("id", id);
      if (error) throw error;

      await loadInvoices(workspaceId);
    } catch (e) {
      setMsg(e.message || "Failed to update invoice.");
    }
  }

  if (!user) return null;

  return (
    <div className={ui.container}>
      <TopNav active="invoices" />

      <div className={ui.header}>
        <div>
          <h1 className={ui.h1}>Invoices</h1>
          <div className={ui.sub}>Create, track, and send invoices.</div>
        </div>

        <div className={ui.actionsRow}>
          <button className={`${ui.btn} ${ui.btnPrimary}`} onClick={openAddModal} disabled={!workspaceId}>
            + Add invoice
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

      <Modal open={showAddModal} title="Add invoice" onClose={closeAddModal}>
        <form className={ui.form} onSubmit={addInvoice}>
          <div className={ui.formGrid2}>
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
            </div>
          </div>

          <div className={ui.formGrid3}>
            <div className={ui.field}>
              <label className={ui.label}>Amount</label>
              <input
                className={ui.input}
                type="number"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g., 5000"
                required
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
              <div className={ui.cardSub}>
                Tip: use <b>sent</b> for “unpaid” dashboard tracking.
              </div>
            </div>

            <div className={ui.field}>
              <label className={ui.label}>Sent date (optional)</label>
              <input
                className={ui.input}
                type="date"
                value={sentDate}
                onChange={(e) => setSentDate(e.target.value)}
                disabled={status !== "sent"}
              />
              <div className={ui.cardSub}>If blank, we’ll default to today when status is sent.</div>
            </div>
          </div>

          <div className={ui.field}>
            <label className={ui.label}>Notes (optional)</label>
            <textarea
              className={ui.textarea}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Invoice #, period covered, deliverables, payment terms, etc."
            />
          </div>

          <div className={ui.formActions}>
            <button type="button" className={ui.btn} onClick={closeAddModal}>
              Cancel
            </button>

            <button type="submit" className={`${ui.btn} ${ui.btnPrimary}`} disabled={!workspaceId}>
              Add invoice
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
                {showAll ? "Showing all statuses." : "Showing draft / sent only."}
              </div>
            </div>
          </div>

          <div className={ui.cardBody}>
            {invoices.length === 0 ? (
              <div className={ui.item}>
                <div>
                  <div className={ui.itemTitle}>No invoices yet.</div>
                  <div className={ui.itemMeta}>Click “Add invoice” to create one.</div>
                </div>
              </div>
            ) : (
              invoices.map((inv) => {
                const sponsor = inv.sponsor_id ? sponsorNameById.get(inv.sponsor_id) : "No sponsor";
                return (
                  <div key={inv.id} className={ui.item}>
                    <div>
                      <div className={ui.itemTitle}>
                        {sponsor} — ${Number(inv.amount).toFixed(2)}
                      </div>
                      <div className={ui.itemMeta}>
                        status: {inv.status}
                        {inv.sent_date ? ` • sent ${inv.sent_date}` : ""}
                        {inv.paid_date ? ` • paid ${inv.paid_date}` : ""}
                      </div>
                      {inv.notes ? <div className={ui.itemMeta}>{inv.notes}</div> : null}
                    </div>

                    <div className={ui.actionsRow}>
                      {inv.status === "draft" ? (
                        <button className={ui.btn} onClick={() => updateInvoiceStatus(inv.id, "sent")}>
                          Mark sent
                        </button>
                      ) : null}
                      {inv.status === "sent" ? (
                        <button className={ui.btn} onClick={() => updateInvoiceStatus(inv.id, "paid")}>
                          Mark paid
                        </button>
                      ) : null}
                      {inv.status !== "void" ? (
                        <button className={ui.btn} onClick={() => updateInvoiceStatus(inv.id, "void")}>
                          Void
                        </button>
                      ) : null}
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

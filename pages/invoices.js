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

function money(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "0.00";
  return x.toFixed(2);
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
  const [saving, setSaving] = useState(false);

  // modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [mode, setMode] = useState("add"); // "add" | "edit"
  const [editingInvoiceId, setEditingInvoiceId] = useState(null);

  // form (header)
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [sponsorId, setSponsorId] = useState("");
  const [contractId, setContractId] = useState("");
  const [status, setStatus] = useState("draft");
  const [sentDate, setSentDate] = useState("");
  const [paidDate, setPaidDate] = useState("");
  const [notes, setNotes] = useState("");

  // line items
  const [lineItems, setLineItems] = useState([{ description: "", quantity: "1", unit_price: "" }]);

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

async function downloadInvoicePdf(inv) {
  setMsg("");
  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) {
      setMsg("You’re not logged in.");
      return;
    }

    const res = await fetch(`/api/invoices/${inv.id}/pdf`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || "PDF download failed");
    }

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `Invoice-${inv.invoice_number || inv.id}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();

    window.URL.revokeObjectURL(url);
  } catch (e) {
    setMsg(e.message || "Failed to download PDF.");
  }
}

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
      .select(
        `
        id,
        invoice_number,
        amount,
        status,
        sent_date,
        paid_date,
        notes,
        sponsor_id,
        contract_id,
        created_at,
        invoice_items (
          id,
          line_no,
          description,
          quantity,
          unit_price,
          created_at
        )
      `
      )
      .eq("workspace_id", wsId)
      .order("created_at", { ascending: false });

    if (!showAll) q = q.in("status", ["draft", "sent"]);

    const { data, error } = await q;
    if (error) throw error;

    const normalized = (data || []).map((inv) => ({
      ...inv,
      invoice_items: [...(inv.invoice_items || [])].sort((a, b) => (a.line_no ?? 0) - (b.line_no ?? 0)),
    }));

    setInvoices(normalized);
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

  const computedTotal = useMemo(() => {
    let total = 0;
    for (const li of lineItems) {
      const qty = Number(li.quantity);
      const unit = Number(li.unit_price);
      const q = Number.isFinite(qty) ? qty : 0;
      const u = Number.isFinite(unit) ? unit : 0;
      total += q * u;
    }
    return total;
  }, [lineItems]);

  // ---- modal helpers ----
  function resetFormDefaults() {
    setInvoiceNumber("");
    setStatus("draft");
    setSentDate("");
    setPaidDate("");
    setNotes("");
    setContractId("");
    setLineItems([{ description: "", quantity: "1", unit_price: "" }]);
    setEditingInvoiceId(null);
  }

  function openAddModal() {
    setMsg("");
    setMode("add");
    if (!sponsorId && sponsors?.length) setSponsorId(sponsors[0].id);
    resetFormDefaults();
    setModalOpen(true);
  }

  function openEditModal(inv) {
    setMsg("");
    setMode("edit");
    setEditingInvoiceId(inv.id);

    setInvoiceNumber(inv.invoice_number || "");
    setSponsorId(inv.sponsor_id || "");
    setContractId(inv.contract_id || "");
    setStatus(inv.status || "draft");
    setSentDate(inv.sent_date || "");
    setPaidDate(inv.paid_date || "");
    setNotes(inv.notes || "");

    const items = (inv.invoice_items || []).length
      ? inv.invoice_items
      : [{ description: "", quantity: 1, unit_price: 0 }];

    setLineItems(
      items.map((it) => ({
        id: it.id,
        description: it.description || "",
        quantity: String(it.quantity ?? 1),
        unit_price: String(it.unit_price ?? 0),
      }))
    );

    setModalOpen(true);
  }

  function closeModal() {
    if (saving) return;
    setModalOpen(false);
  }

  function updateLineItem(idx, patch) {
    setLineItems((prev) => prev.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
  }

  function addLineItemRow() {
    setLineItems((prev) => [...prev, { description: "", quantity: "1", unit_price: "" }]);
  }

  function removeLineItemRow(idx) {
    setLineItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function normalizeLineItemsForSave() {
    const cleaned = lineItems
      .map((li) => ({
        description: (li.description || "").trim(),
        quantity: Number(li.quantity),
        unit_price: Number(li.unit_price),
      }))
      .filter((li) => li.description.length > 0);

    if (cleaned.length === 0) return { ok: false, error: "Add at least one line item (description required)." };

    for (const li of cleaned) {
      if (!Number.isFinite(li.quantity) || li.quantity <= 0) {
        return { ok: false, error: "Each line item quantity must be a positive number." };
      }
      if (!Number.isFinite(li.unit_price) || li.unit_price < 0) {
        return { ok: false, error: "Each line item unit price must be 0 or greater." };
      }
    }

    return { ok: true, items: cleaned };
  }

  function computeEffectiveDates(nextStatus) {
    const today = toISODateInput(new Date());

    let nextSent = sentDate || null;
    let nextPaid = paidDate || null;

    if (nextStatus === "sent") {
      if (!nextSent) nextSent = today;
      nextPaid = null;
    }

    if (nextStatus === "paid") {
      if (!nextSent) nextSent = today;
      if (!nextPaid) nextPaid = today;
    }

    if (nextStatus === "draft") {
      nextSent = null;
      nextPaid = null;
    }

    return { nextSent, nextPaid };
  }

  // ---- actions ----
  async function addInvoice(e) {
    e.preventDefault();
    setMsg("");
    if (saving) return;

    if (!workspaceId) {
      setMsg("No workspace loaded. Cannot add invoice.");
      return;
    }

    const norm = normalizeLineItemsForSave();
    if (!norm.ok) {
      setMsg(norm.error);
      return;
    }

    const cleanInvNo = invoiceNumber.trim() || null;
    const { nextSent, nextPaid } = computeEffectiveDates(status);

    setSaving(true);
    try {
      const invPayload = {
        workspace_id: workspaceId,
        invoice_number: cleanInvNo,
        sponsor_id: sponsorId || null,
        contract_id: contractId || null,
        amount: Number(computedTotal),
        status,
        sent_date: nextSent,
        paid_date: nextPaid,
        notes: notes.trim() || null,
      };

      const { data: invRow, error: invErr } = await supabase.from("invoices").insert(invPayload).select("id").single();
      if (invErr) throw invErr;

      const invoiceId = invRow.id;

      const itemsPayload = norm.items.map((li, i) => ({
        workspace_id: workspaceId,
        invoice_id: invoiceId,
        line_no: i + 1,
        description: li.description,
        quantity: li.quantity,
        unit_price: li.unit_price,
      }));

      const { error: itemsErr } = await supabase.from("invoice_items").insert(itemsPayload);
      if (itemsErr) throw itemsErr;

      resetFormDefaults();
      setModalOpen(false);
      await loadInvoices(workspaceId);
    } catch (e2) {
      setMsg(e2.message || "Failed to add invoice.");
    } finally {
      setSaving(false);
    }
  }

  async function saveInvoiceEdits(e) {
    e.preventDefault();
    setMsg("");
    if (saving) return;

    if (!workspaceId || !editingInvoiceId) {
      setMsg("No invoice selected.");
      return;
    }

    const norm = normalizeLineItemsForSave();
    if (!norm.ok) {
      setMsg(norm.error);
      return;
    }

    const cleanInvNo = invoiceNumber.trim() || null;
    const { nextSent, nextPaid } = computeEffectiveDates(status);

    setSaving(true);
    try {
      const invPatch = {
        invoice_number: cleanInvNo,
        sponsor_id: sponsorId || null,
        contract_id: contractId || null,
        amount: Number(computedTotal),
        status,
        sent_date: nextSent,
        paid_date: nextPaid,
        notes: notes.trim() || null,
      };

      const { error: upErr } = await supabase.from("invoices").update(invPatch).eq("id", editingInvoiceId);
      if (upErr) throw upErr;

      const { error: delErr } = await supabase.from("invoice_items").delete().eq("invoice_id", editingInvoiceId);
      if (delErr) throw delErr;

      const itemsPayload = norm.items.map((li, i) => ({
        workspace_id: workspaceId,
        invoice_id: editingInvoiceId,
        line_no: i + 1,
        description: li.description,
        quantity: li.quantity,
        unit_price: li.unit_price,
      }));

      const { error: insErr } = await supabase.from("invoice_items").insert(itemsPayload);
      if (insErr) throw insErr;

      resetFormDefaults();
      setModalOpen(false);
      await loadInvoices(workspaceId);
    } catch (e2) {
      setMsg(e2.message || "Failed to save invoice edits.");
    } finally {
      setSaving(false);
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

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={openAddModal} disabled={!workspaceId} className={`${ui.btn} ${ui.btnPrimary}`}>
            + Add invoice
          </button>

          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            Show all (including paid/void)
          </label>
        </div>
      </div>

      {msg ? <div className={ui.notice}>{msg}</div> : null}

      <Modal open={modalOpen} title={mode === "edit" ? "Edit invoice" : "Add invoice"} onClose={closeModal}>
        <form onSubmit={mode === "edit" ? saveInvoiceEdits : addInvoice} style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 800, opacity: 0.9 }}>Invoice number (optional)</div>
              <input
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                disabled={saving || (mode === "edit" && !!invoiceNumber)}
                placeholder="INV-001"
                />
            </div>

            <div>
              <div style={{ fontSize: 13, fontWeight: 800, opacity: 0.9 }}>Sponsor</div>
              <select
                style={{ width: "100%", marginTop: 6, padding: 10 }}
                value={sponsorId}
                onChange={(e) => setSponsorId(e.target.value)}
                disabled={!sponsors.length || !workspaceId || saving}
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

          <div>
            <div style={{ fontSize: 13, fontWeight: 800, opacity: 0.9 }}>Contract (optional)</div>
            <select
              style={{ width: "100%", marginTop: 6, padding: 10 }}
              value={contractId}
              onChange={(e) => setContractId(e.target.value)}
              disabled={!workspaceId || saving}
            >
              <option value="">(No contract)</option>
              {contractsForSelectedSponsor.map((c) => (
                <option key={c.id} value={c.id}>
                  {(c.start_date || "—") + " → " + (c.end_date || "—")}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 800, opacity: 0.9 }}>Status</div>
              <select
                style={{ width: "100%", marginTop: 6, padding: 10 }}
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                disabled={saving}
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div style={{ fontSize: 13, fontWeight: 800, opacity: 0.9 }}>Sent date</div>
              <input
                style={{ width: "100%", marginTop: 6, padding: 10 }}
                type="date"
                value={sentDate}
                onChange={(e) => setSentDate(e.target.value)}
                disabled={saving}
              />
            </div>

            <div>
              <div style={{ fontSize: 13, fontWeight: 800, opacity: 0.9 }}>Total</div>
              <div style={{ marginTop: 10, fontWeight: 900 }}>${money(computedTotal)}</div>
            </div>
          </div>

          <div>
            <div style={{ fontSize: 13, fontWeight: 900, opacity: 0.9, marginBottom: 8 }}>Line items</div>

            <div style={{ display: "grid", gap: 10 }}>
              {lineItems.map((li, idx) => {
                const qty = Number(li.quantity);
                const unit = Number(li.unit_price);
                const lineTotal = (Number.isFinite(qty) ? qty : 0) * (Number.isFinite(unit) ? unit : 0);

                return (
                  <div
                    key={idx}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1.8fr 0.6fr 0.8fr 0.8fr auto",
                      gap: 8,
                      alignItems: "end",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 800, opacity: 0.8 }}>Description</div>
                      <input
                        style={{ width: "100%", marginTop: 6, padding: 10 }}
                        value={li.description}
                        onChange={(e) => updateLineItem(idx, { description: e.target.value })}
                        placeholder="e.g., Sponsored content — IG reel"
                        disabled={saving}
                      />
                    </div>

                    <div>
                      <div style={{ fontSize: 12, fontWeight: 800, opacity: 0.8 }}>Qty</div>
                      <input
                        style={{ width: "100%", marginTop: 6, padding: 10 }}
                        type="number"
                        step="0.01"
                        value={li.quantity}
                        onChange={(e) => updateLineItem(idx, { quantity: e.target.value })}
                        disabled={saving}
                      />
                    </div>

                    <div>
                      <div style={{ fontSize: 12, fontWeight: 800, opacity: 0.8 }}>Unit</div>
                      <input
                        style={{ width: "100%", marginTop: 6, padding: 10 }}
                        type="number"
                        step="0.01"
                        value={li.unit_price}
                        onChange={(e) => updateLineItem(idx, { unit_price: e.target.value })}
                        disabled={saving}
                      />
                    </div>

                    <div>
                      <div style={{ fontSize: 12, fontWeight: 800, opacity: 0.8 }}>Line total</div>
                      <div style={{ marginTop: 10, fontWeight: 900 }}>${money(lineTotal)}</div>
                    </div>

                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        type="button"
                        className={ui.btn}
                        onClick={() => removeLineItemRow(idx)}
                        disabled={saving || lineItems.length === 1}
                      >
                        −
                      </button>
                      {idx === lineItems.length - 1 ? (
                        <button type="button" className={ui.btn} onClick={addLineItemRow} disabled={saving}>
                          +
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 13, fontWeight: 800, opacity: 0.9 }}>Notes (optional)</div>
            <textarea
              style={{ width: "100%", marginTop: 6, padding: 10, minHeight: 90 }}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Invoice #, period covered, payment terms, etc."
              disabled={saving}
            />
          </div>

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
            <button type="button" className={ui.btn} onClick={closeModal} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className={`${ui.btn} ${ui.btnPrimary}`} disabled={!workspaceId || saving}>
              {saving ? "Saving…" : mode === "edit" ? "Save changes" : "Add invoice"}
            </button>
          </div>
        </form>
      </Modal>

      {/* List */}
      <div className={ui.grid}>
        <div className={`${ui.card} ${ui.span2}`}>
          <div className={ui.cardHeader}>
            <div>
              <h2 className={ui.h2}>Invoices</h2>
              <div className={ui.cardSub}>
                {showAll ? "All invoices" : "Open invoices (draft/sent)"} • {invoices.length} shown
              </div>
            </div>
          </div>

          <div className={ui.cardBody}>
            {invoices.length === 0 ? (
              <div className={ui.item}>
                <div>
                  <div className={ui.itemTitle}>No invoices yet.</div>
                  <div className={ui.itemMeta}>Create one with “Add invoice”.</div>
                </div>
              </div>
            ) : (
              invoices.map((inv) => {
                const sponsor = inv.sponsor_id ? sponsorNameById.get(inv.sponsor_id) : "No sponsor";
                const items = inv.invoice_items || [];

                return (
                  <div key={inv.id} className={ui.item} style={{ alignItems: "flex-start" }}>
                    <div>
                      <div className={ui.itemTitle}>
                        {inv.invoice_number ? (
                          <span style={{ opacity: 0.85, fontWeight: 950, marginRight: 8 }}>
                            {inv.invoice_number}
                          </span>
                        ) : null}
                        {sponsor} — ${money(inv.amount)}{" "}
                        <span style={{ opacity: 0.7, fontWeight: 800, marginLeft: 8 }}>({inv.status})</span>
                      </div>

                      <div className={ui.itemMeta}>
                        {inv.sent_date ? `sent ${inv.sent_date}` : "not sent"}
                        {inv.paid_date ? ` • paid ${inv.paid_date}` : ""}
                        {items.length ? ` • ${items.length} line item${items.length === 1 ? "" : "s"}` : ""}
                      </div>

                      {items.length ? (
                        <div className={ui.itemMeta} style={{ marginTop: 10 }}>
                          {items.map((it) => (
                            <div key={it.id} style={{ marginTop: 4 }}>
                              • {it.description} — {money(it.quantity)} × ${money(it.unit_price)}
                            </div>
                          ))}
                        </div>
                      ) : null}

                      {inv.notes ? <div className={ui.itemMeta} style={{ marginTop: 10 }}>{inv.notes}</div> : null}
                    </div>

                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <button className={ui.btn} onClick={() => openEditModal(inv)}>
                        Edit
                      </button>
                      <button className={ui.btn} onClick={() => downloadInvoicePdf(inv)}>
                        Download Invoice PDF
                        </button>
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

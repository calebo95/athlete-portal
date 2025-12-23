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

export default function ContactsPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [workspaceId, setWorkspaceId] = useState(null);

  // UI
  const [msg, setMsg] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);

  // data
  const [sponsors, setSponsors] = useState([]);
  const [contacts, setContacts] = useState([]);

  // filters
  const [filterSponsorId, setFilterSponsorId] = useState("");

  // form
  const [sponsorId, setSponsorId] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [lastTouchDate, setLastTouchDate] = useState("");
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

  async function loadContacts(wsId) {
    let q = supabase
      .from("contacts")
      .select("id,name,role,company,email,phone,last_touch_date,notes,sponsor_id,created_at")
      .eq("workspace_id", wsId)
      .order("last_touch_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });

    if (filterSponsorId) q = q.eq("sponsor_id", filterSponsorId);

    const { data, error } = await q;
    if (error) throw error;
    setContacts(data || []);
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
          setContacts([]);
          setMsg("No workspace found for this user. Ask the owner to add you as a workspace member.");
          return;
        }

        setWorkspaceId(wsId);
        await loadSponsors(wsId);
        await loadContacts(wsId);
      } catch (e) {
        setMsg(e.message || "Failed to load contacts.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, filterSponsorId]);

  // ---- modal helpers ----
  function resetFormDefaults() {
    setName("");
    setRole("");
    setCompany("");
    setEmail("");
    setPhone("");
    setLastTouchDate("");
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
  async function addContact(e) {
    e.preventDefault();
    setMsg("");

    if (!workspaceId) {
      setMsg("No workspace loaded. Cannot add contact.");
      return;
    }

    const cleanName = name.trim();
    if (!cleanName) {
      setMsg("Name is required.");
      return;
    }

    const payload = {
      workspace_id: workspaceId,
      sponsor_id: sponsorId || null,
      name: cleanName,
      role: role.trim() || null,
      company: company.trim() || null,
      email: email.trim() || null,
      phone: phone.trim() || null,
      last_touch_date: lastTouchDate || null,
      notes: notes.trim() || null,
    };

    const { error } = await supabase.from("contacts").insert(payload);
    if (error) {
      setMsg(error.message);
      return;
    }

    resetFormDefaults();
    setShowAddModal(false);
    await loadContacts(workspaceId);
  }

  async function touchToday(id) {
    setMsg("");
    const today = toISODateInput(new Date());
    const { error } = await supabase.from("contacts").update({ last_touch_date: today }).eq("id", id);

    if (error) setMsg(error.message);
    else loadContacts(workspaceId);
  }

  async function deleteContact(id) {
    setMsg("");
    const ok = confirm("Delete this contact?");
    if (!ok) return;

    const { error } = await supabase.from("contacts").delete().eq("id", id);
    if (error) setMsg(error.message);
    else loadContacts(workspaceId);
  }

  if (!user) return null;

  return (
    <div className={ui.container}>
      <TopNav active="contacts" />

      <div className={ui.header}>
        <div>
          <h1 className={ui.h1}>Contacts</h1>
          <div className={ui.sub}>Track sponsor contacts and keep a simple “last touch” log.</div>
        </div>

        <div className={ui.actionsRow}>
          <button className={`${ui.btn} ${ui.btnPrimary}`} onClick={openAddModal} disabled={!workspaceId}>
            + Add contact
          </button>
        </div>
      </div>

      {msg ? <div className={ui.notice}>{msg}</div> : null}

      <div className={ui.grid}>
        <div className={`${ui.card} ${ui.span2}`}>
          <div className={ui.cardHeader}>
            <div>
              <h2 className={ui.h2}>List</h2>
              <div className={ui.cardSub}>
                {filterSponsorId
                  ? `Filtered: ${sponsorNameById.get(filterSponsorId) || "Sponsor"}`
                  : "All contacts"}
              </div>
            </div>

            <div className={ui.actionsRow}>
              <select
                className={ui.select}
                value={filterSponsorId}
                onChange={(e) => setFilterSponsorId(e.target.value)}
                disabled={!workspaceId}
                aria-label="Filter sponsor"
              >
                <option value="">(All sponsors)</option>
                {sponsors.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className={ui.cardBody}>
            {contacts.length === 0 ? (
              <div className={ui.item}>
                <div>
                  <div className={ui.itemTitle}>No contacts yet.</div>
                  <div className={ui.itemMeta}>Click “Add contact” to create one.</div>
                </div>
              </div>
            ) : (
              contacts.map((c) => {
                const sponsor = c.sponsor_id ? sponsorNameById.get(c.sponsor_id) : null;
                return (
                  <div key={c.id} className={ui.item}>
                    <div>
                      <div className={ui.itemTitle}>{c.name}</div>

                      <div className={ui.itemMeta}>
                        {sponsor ? `${sponsor} • ` : ""}
                        {c.role ? `${c.role} • ` : ""}
                        {c.company ? c.company : ""}
                      </div>

                      {(c.email || c.phone) ? (
                        <div className={ui.itemMeta}>
                          {c.email ? (
                            <span>
                              email: <a href={`mailto:${c.email}`}>{c.email}</a>
                            </span>
                          ) : null}
                          {c.email && c.phone ? <span> • </span> : null}
                          {c.phone ? <span>phone: {c.phone}</span> : null}
                        </div>
                      ) : null}

                      <div className={ui.itemMeta}>
                        last touch: <b>{c.last_touch_date || "—"}</b>
                      </div>

                      {c.notes ? <div className={ui.itemMeta}>{c.notes}</div> : null}
                    </div>

                    <div className={ui.actionsRow}>
                      <button className={ui.btn} onClick={() => touchToday(c.id)}>
                        Touched today
                      </button>
                      <button className={ui.btn} onClick={() => deleteContact(c.id)}>
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

      <Modal open={showAddModal} title="Add contact" onClose={closeAddModal}>
        <form className={ui.form} onSubmit={addContact}>
          <div className={ui.formGrid2}>
            <div className={ui.field}>
              <label className={ui.label}>Name</label>
              <input
                className={ui.input}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Jane Doe"
                required
              />
            </div>

            <div className={ui.field}>
              <label className={ui.label}>Sponsor (optional)</label>
              <select
                className={ui.select}
                value={sponsorId}
                onChange={(e) => setSponsorId(e.target.value)}
                disabled={!sponsors.length || !workspaceId}
              >
                {sponsors.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
                <option value="">(No sponsor)</option>
              </select>
            </div>
          </div>

          <div className={ui.formGrid3}>
            <div className={ui.field}>
              <label className={ui.label}>Role (optional)</label>
              <input
                className={ui.input}
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="Brand Manager / PR / Agent / RD"
              />
            </div>

            <div className={ui.field}>
              <label className={ui.label}>Company (optional)</label>
              <input
                className={ui.input}
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="Nike / UTMB / etc."
              />
            </div>

            <div className={ui.field}>
              <label className={ui.label}>Last touch date (optional)</label>
              <input
                className={ui.input}
                type="date"
                value={lastTouchDate}
                onChange={(e) => setLastTouchDate(e.target.value)}
              />
            </div>
          </div>

          <div className={ui.formGrid2}>
            <div className={ui.field}>
              <label className={ui.label}>Email (optional)</label>
              <input
                className={ui.input}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
              />
            </div>

            <div className={ui.field}>
              <label className={ui.label}>Phone (optional)</label>
              <input
                className={ui.input}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1 (555) 123-4567"
              />
            </div>
          </div>

          <div className={ui.field}>
            <label className={ui.label}>Notes (optional)</label>
            <textarea
              className={ui.textarea}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What they care about, preferred comms, key dates, etc."
            />
          </div>

          <div className={ui.formActions}>
            <button type="button" className={ui.btn} onClick={closeAddModal}>
              Cancel
            </button>

            <button type="submit" className={`${ui.btn} ${ui.btnPrimary}`} disabled={!workspaceId}>
              Add contact
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

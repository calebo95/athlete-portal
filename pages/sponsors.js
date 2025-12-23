import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/router";
import TopNav from "@/components/TopNav";
import Modal from "@/components/Modal";
import ui from "@/styles/ui.module.css";
import "@/styles/globals.css";

export default function SponsorsPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [workspaceId, setWorkspaceId] = useState(null);

  // UI
  const [msg, setMsg] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);

  // form
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");

  // data
  const [sponsors, setSponsors] = useState([]);

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

  async function loadSponsors(wsId) {
    setMsg("");
    const { data, error } = await supabase
      .from("sponsors")
      .select("id,name,notes,created_at")
      .eq("workspace_id", wsId)
      .order("name", { ascending: true });

    if (error) setMsg(error.message);
    else setSponsors(data || []);
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
          setMsg("No workspace found for this user. Ask the owner to add you as a workspace member.");
          return;
        }

        setWorkspaceId(wsId);
        await loadSponsors(wsId);
      } catch (e) {
        setMsg(e.message || "Failed to load sponsors.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // ---- modal helpers ----
  function resetFormDefaults() {
    setName("");
    setNotes("");
  }

  function openAddModal() {
    setMsg("");
    resetFormDefaults();
    setShowAddModal(true);
  }

  function closeAddModal() {
    setShowAddModal(false);
  }

  async function addSponsor(e) {
    e.preventDefault();
    setMsg("");

    if (!workspaceId) {
      setMsg("No workspace loaded. Cannot add sponsor.");
      return;
    }

    const clean = name.trim();
    if (!clean) {
      setMsg("Name is required.");
      return;
    }

    const { error } = await supabase.from("sponsors").insert({
      workspace_id: workspaceId,
      name: clean,
      notes: notes.trim() || null,
    });

    if (error) {
      setMsg(error.message);
      return;
    }

    resetFormDefaults();
    setShowAddModal(false);
    await loadSponsors(workspaceId);
  }

  async function deleteSponsor(id) {
    setMsg("");
    const ok = confirm("Delete this sponsor? (This will also delete contracts via cascade.)");
    if (!ok) return;

    const { error } = await supabase.from("sponsors").delete().eq("id", id);
    if (error) setMsg(error.message);
    else loadSponsors(workspaceId);
  }

  if (!user) return null;

  return (
    <div className={ui.container}>
      <TopNav active="sponsors" />

      <div className={ui.header}>
        <div>
          <h1 className={ui.h1}>Sponsors</h1>
          <div className={ui.sub}>Keep your sponsor list clean and consistent across contracts, invoices, and obligations.</div>
        </div>

        <div className={ui.actionsRow}>
          <button className={`${ui.btn} ${ui.btnPrimary}`} onClick={openAddModal} disabled={!workspaceId}>
            + Add sponsor
          </button>
        </div>
      </div>

      {msg ? <div className={ui.notice}>{msg}</div> : null}

      <Modal open={showAddModal} title="Add sponsor" onClose={closeAddModal}>
        <form className={ui.form} onSubmit={addSponsor}>
          <div className={ui.field}>
            <label className={ui.label}>Name</label>
            <input
              className={ui.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Nike"
              disabled={!workspaceId}
              required
            />
          </div>

          <div className={ui.field}>
            <label className={ui.label}>Notes (optional)</label>
            <textarea
              className={ui.textarea}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Contract notes, deliverables, contacts, etc."
              disabled={!workspaceId}
            />
          </div>

          <div className={ui.formActions}>
            <button type="button" className={ui.btn} onClick={closeAddModal}>
              Cancel
            </button>
            <button type="submit" className={`${ui.btn} ${ui.btnPrimary}`} disabled={!workspaceId}>
              Add sponsor
            </button>
          </div>
        </form>
      </Modal>

      <div className={ui.grid}>
        <div className={`${ui.card} ${ui.span2}`}>
          <div className={ui.cardHeader}>
            <div>
              <h2 className={ui.h2}>List</h2>
              <div className={ui.cardSub}>{sponsors.length ? `${sponsors.length} sponsor(s)` : "No sponsors yet."}</div>
            </div>
          </div>

          <div className={ui.cardBody}>
            {sponsors.length === 0 ? (
              <div className={ui.item}>
                <div>
                  <div className={ui.itemTitle}>No sponsors yet.</div>
                  <div className={ui.itemMeta}>Click “Add sponsor” to create one.</div>
                </div>
              </div>
            ) : (
              sponsors.map((s) => (
                <div key={s.id} className={ui.item}>
                  <div>
                    <div className={ui.itemTitle}>{s.name}</div>
                    {s.notes ? <div className={ui.itemMeta}>{s.notes}</div> : null}
                  </div>

                  <div className={ui.actionsRow}>
                    <button className={ui.btn} onClick={() => deleteSponsor(s.id)}>
                      Delete
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

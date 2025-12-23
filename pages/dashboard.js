import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/router";
import TopNav from "@/components/TopNav";
import ui from "@/styles/ui.module.css";
import "@/styles/globals.css";

function toISODate(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDaysISO(iso, days) {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

export default function Dashboard() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [workspaceId, setWorkspaceId] = useState(null);

  const [msg, setMsg] = useState("");

  const [sponsors, setSponsors] = useState([]);
  const [overdue, setOverdue] = useState([]);
  const [dueSoon, setDueSoon] = useState([]);
  const [unpaidInvoices, setUnpaidInvoices] = useState([]);
  const [contractsEnding, setContractsEnding] = useState([]);

  const todayISO = useMemo(() => toISODate(new Date()), []);
  const next7ISO = useMemo(() => addDaysISO(todayISO, 7), [todayISO]);
  const next60ISO = useMemo(() => addDaysISO(todayISO, 60), [todayISO]);

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

  async function loadAll(wsIdParam) {
    setMsg("");
    try {
      const wsId = wsIdParam || workspaceId;
      if (!wsId) {
        setMsg("No workspace found for this user. Ask the owner to add you as a workspace member.");
        setSponsors([]);
        setOverdue([]);
        setDueSoon([]);
        setUnpaidInvoices([]);
        setContractsEnding([]);
        return;
      }

      // Sponsors
      const s = await supabase.from("sponsors").select("id,name").eq("workspace_id", wsId).order("name");
      if (s.error) throw s.error;
      setSponsors(s.data || []);

      // Overdue obligations
      const o1 = await supabase
        .from("obligations")
        .select("id,title,type,due_date,status,sponsor_id")
        .eq("workspace_id", wsId)
        .lt("due_date", todayISO)
        .in("status", ["pending", "in_progress"])
        .order("due_date", { ascending: true });

      if (o1.error) throw o1.error;
      setOverdue(o1.data || []);

      // Due soon obligations
      const o2 = await supabase
        .from("obligations")
        .select("id,title,type,due_date,status,sponsor_id")
        .eq("workspace_id", wsId)
        .gte("due_date", todayISO)
        .lte("due_date", next7ISO)
        .in("status", ["pending", "in_progress"])
        .order("due_date", { ascending: true });

      if (o2.error) throw o2.error;
      setDueSoon(o2.data || []);

      // Unpaid invoices (sent)
      const inv = await supabase
        .from("invoices")
        .select("id,amount,status,sent_date,paid_date,sponsor_id,contract_id,notes")
        .eq("workspace_id", wsId)
        .in("status", ["sent"])
        .order("sent_date", { ascending: false });

      if (inv.error) throw inv.error;
      setUnpaidInvoices(inv.data || []);

      // Contracts ending soon (next 60 days)
      const c = await supabase
        .from("contracts")
        .select("id,sponsor_id,start_date,end_date,base_pay,notes")
        .eq("workspace_id", wsId)
        .gte("end_date", todayISO)
        .lte("end_date", next60ISO)
        .order("end_date", { ascending: true });

      if (c.error) throw c.error;
      setContractsEnding(c.data || []);
    } catch (e) {
      setMsg(e.message || "Failed to load dashboard.");
    }
  }

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        setMsg("");
        const wsId = await loadWorkspaceId();
        setWorkspaceId(wsId);

        if (!wsId) {
          setMsg("No workspace found for this user. Ask the owner to add you as a workspace member.");
          return;
        }

        await loadAll(wsId);
      } catch (e) {
        setMsg(e.message || "Failed to load dashboard.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function setObligationStatus(id, nextStatus) {
    setMsg("");
    const { error } = await supabase.from("obligations").update({ status: nextStatus }).eq("id", id);
    if (error) setMsg(error.message);
    else loadAll();
  }

  if (!user) return null;

  function CardSection({ title, sub, right, children, span2 }) {
    return (
      <div className={`${ui.card} ${span2 ? ui.span2 : ""}`}>
        <div className={ui.cardHeader}>
          <div>
            <h2 className={ui.h2}>{title}</h2>
            {sub ? <div className={ui.cardSub}>{sub}</div> : null}
          </div>
          {right ? <div>{right}</div> : null}
        </div>
        <div className={ui.cardBody}>{children}</div>
      </div>
    );
  }

  function EmptyRow({ title, meta }) {
    return (
      <div className={ui.item}>
        <div>
          <div className={ui.itemTitle}>{title}</div>
          {meta ? <div className={ui.itemMeta}>{meta}</div> : null}
        </div>
      </div>
    );
  }

  function ObligationRows({ items, emptyText }) {
    if (!items.length) return <EmptyRow title={emptyText} meta="" />;
    return items.map((o) => {
      const sponsor = o.sponsor_id ? sponsorNameById.get(o.sponsor_id) : null;
      return (
        <div key={o.id} className={ui.item}>
          <div>
            <div className={ui.itemTitle}>{o.title}</div>
            <div className={ui.itemMeta}>
              {sponsor ? `${sponsor} • ` : ""}
              {o.type} • {o.status} • due <span className={ui.mono}>{o.due_date}</span>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className={ui.btn} onClick={() => setObligationStatus(o.id, "done")}>
              Mark done
            </button>
            <button className={`${ui.btn} ${ui.btnPrimary}`} onClick={() => router.push("/obligations")}>
              Open
            </button>
          </div>
        </div>
      );
    });
  }

  return (
    <div className={ui.container}>
      <TopNav active="dashboard" />

      <div className={ui.header}>
        <div>
          <h1 className={ui.h1}>This Week</h1>
          <div className={ui.sub}>
            <span className={ui.mono}>{todayISO}</span> → <span className={ui.mono}>{next7ISO}</span>
            <br />
            Logged in as: <b>{user.email}</b>
          </div>
        </div>

        <div className={ui.kpis}>
          <div className={`${ui.kpi} ${overdue.length ? ui.kpiDanger : ""}`}>Overdue: {overdue.length}</div>
          <div className={ui.kpi}>Due soon: {dueSoon.length}</div>
          <div className={ui.kpi}>Unpaid invoices: {unpaidInvoices.length}</div>
          <div className={ui.kpi}>Contracts ending: {contractsEnding.length}</div>
        </div>
      </div>

      {msg ? <div className={ui.notice}>{msg}</div> : null}

      <div className={ui.grid}>
        <CardSection
          title={`Overdue (${overdue.length})`}
          sub="Pending or in-progress obligations past due."
          right={
            <button className={ui.btn} onClick={() => router.push("/obligations")}>
              Manage
            </button>
          }
        >
          <ObligationRows items={overdue} emptyText="Nothing overdue. Keep it rolling." />
        </CardSection>

        <CardSection
          title={`Due in next 7 days (${dueSoon.length})`}
          sub="Upcoming obligations due soon."
          right={
            <button className={ui.btn} onClick={() => router.push("/obligations")}>
              Add / Edit
            </button>
          }
        >
          <ObligationRows items={dueSoon} emptyText="Nothing due soon. (That’s rare. Enjoy it.)" />
        </CardSection>

        <CardSection
          title={`Unpaid invoices (${unpaidInvoices.length})`}
          sub="Invoices marked as sent."
          right={
            <button className={ui.btn} onClick={() => router.push("/invoices")}>
              Open
            </button>
          }
          span2
        >
          {unpaidInvoices.length === 0 ? (
            <EmptyRow title="No unpaid invoices." meta="" />
          ) : (
            unpaidInvoices.map((i) => {
              const sponsor = i.sponsor_id ? sponsorNameById.get(i.sponsor_id) : null;
              return (
                <div key={i.id} className={ui.item}>
                  <div>
                    <div className={ui.itemTitle}>
                      {sponsor || "Unknown sponsor"} — <span className={ui.mono}>${Number(i.amount).toFixed(2)}</span>
                    </div>
                    <div className={ui.itemMeta}>
                      status: {i.status}
                      {i.sent_date ? ` • sent ${i.sent_date}` : ""}
                      {i.notes ? ` • ${i.notes}` : ""}
                    </div>
                  </div>
                  <div>
                    <button className={ui.btn} onClick={() => router.push("/invoices")}>
                      View
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </CardSection>

        <CardSection
          title={`Contracts ending in 60 days (${contractsEnding.length})`}
          sub={`From ${todayISO} → ${next60ISO}`}
          right={
            <button className={ui.btn} onClick={() => router.push("/contracts")}>
              Open
            </button>
          }
          span2
        >
          {contractsEnding.length === 0 ? (
            <EmptyRow title="No contracts ending soon." meta="" />
          ) : (
            contractsEnding.map((c) => {
              const sponsor = c.sponsor_id ? sponsorNameById.get(c.sponsor_id) : null;
              return (
                <div key={c.id} className={ui.item}>
                  <div>
                    <div className={ui.itemTitle}>{sponsor || "Unknown sponsor"}</div>
                    <div className={ui.itemMeta}>
                      ends <span className={ui.mono}>{c.end_date}</span>
                      {c.base_pay ? ` • base $${Number(c.base_pay).toFixed(2)}` : ""}
                    </div>
                  </div>
                  <div>
                    <button className={ui.btn} onClick={() => router.push("/contracts")}>
                      View
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </CardSection>
      </div>
    </div>
  );
}

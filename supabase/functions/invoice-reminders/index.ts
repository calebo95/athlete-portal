import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PROJECT_URL = Deno.env.get("PROJECT_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET")!;

// set to your verified Resend sender
const FROM_EMAIL = Deno.env.get("REMINDER_FROM_EMAIL")!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  // simple auth gate so only your cron can call this
  const got = req.headers.get("x-cron-secret");
  if (!got || got !== CRON_SECRET) return json({ error: "Unauthorized" }, 401);

  const supabase = createClient(PROJECT_URL, SERVICE_ROLE_KEY);

  // invoices that are: sent, unpaid, 30+ days old, and not yet reminded
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);

  const cutoffISO = cutoff.toISOString().slice(0, 10); // YYYY-MM-DD

  const { data: invoices, error } = await supabase
    .from("invoices")
    .select("id, amount, sent_date, sponsor_id, created_by, reminder_sent_at")
    .eq("status", "sent")
    .is("paid_date", null)
    .is("reminder_sent_at", null)
    .lte("sent_date", cutoffISO)
    .limit(200);

  if (error) return json({ error: error.message }, 500);
  if (!invoices?.length) return json({ ok: true, processed: 0 });

  // fetch sponsor names for nicer emails
  const sponsorIds = Array.from(new Set(invoices.map((i) => i.sponsor_id).filter(Boolean)));
  const sponsorMap = new Map<string, string>();

  if (sponsorIds.length) {
    const { data: sponsors } = await supabase
      .from("sponsors")
      .select("id,name")
      .in("id", sponsorIds);

    (sponsors || []).forEach((s) => sponsorMap.set(s.id, s.name));
  }

  // group by created_by (so one email per user, not per invoice)
  const byUser = new Map<string, typeof invoices>();
  for (const inv of invoices) {
    if (!inv.created_by) continue;
    const list = byUser.get(inv.created_by) || [];
    list.push(inv);
    byUser.set(inv.created_by, list);
  }

  // look up user emails
  const userIds = Array.from(byUser.keys());
  const { data: users, error: usersErr } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (usersErr) return json({ error: usersErr.message }, 500);

  const emailById = new Map<string, string>();
  for (const u of users?.users || []) {
    if (u.email) emailById.set(u.id, u.email);
  }

  let sentCount = 0;
  const remindedInvoiceIds: string[] = [];

  for (const [userId, list] of byUser.entries()) {
    const to = emailById.get(userId);
    if (!to) continue;

    const lines = list.map((inv) => {
      const sponsor = inv.sponsor_id ? sponsorMap.get(inv.sponsor_id) : null;
      const sponsorLabel = sponsor || "Unknown sponsor";
      const amt = Number(inv.amount).toFixed(2);
      return `• ${sponsorLabel} — $${amt} (sent ${inv.sent_date || "—"})`;
    });

    const subject = `Invoice reminder: ${list.length} unpaid invoice${list.length === 1 ? "" : "s"} (30+ days)`;

    const html = `
      <div style="font-family: ui-sans-serif, system-ui, -apple-system; line-height: 1.5;">
        <p>Hey Caleb,</p>
        <p>Quick reminder: these invoices have been <b>unpaid for 30+ days</b> after being sent:</p>
        <pre style="background:#0b1220;color:#e6edf3;padding:12px;border-radius:10px;overflow:auto;">${lines.join("\n")}</pre>
        <p>If you’ve already been paid, mark them as paid in the portal.</p>
        <p>— Athlete Portal</p>
      </div>
    `;

    const resendResp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to,
        subject,
        html,
      }),
    });

    if (!resendResp.ok) {
      // don't mark reminders if the email failed
      continue;
    }

    sentCount += 1;
    list.forEach((inv) => remindedInvoiceIds.push(inv.id));
  }

  // mark invoices as reminded
  if (remindedInvoiceIds.length) {
    await supabase
      .from("invoices")
      .update({ reminder_sent_at: new Date().toISOString() })
      .in("id", remindedInvoiceIds);
  }

  return json({ ok: true, emails_sent: sentCount, invoices_marked: remindedInvoiceIds.length });
});

import { createClient } from "@supabase/supabase-js";
import { PDFDocument, StandardFonts } from "pdf-lib";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function money(value) {
  const n = Number(value ?? 0);
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).send("Method not allowed");

  try {
    const { invoiceId } = req.query;

    // ✅ Read token from Authorization header
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return res.status(401).send("Missing Authorization token");

    // ✅ Create a supabase client that runs queries AS THIS USER (RLS applies)
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // ✅ Verify token
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) return res.status(401).send("Invalid token");

    // Load invoice + items
    const { data: invoice, error: invErr } = await supabase
      .from("invoices")
      .select(
        `
        id,
        workspace_id,
        invoice_number,
        amount,
        status,
        sent_date,
        paid_date,
        notes,
        sponsor_id,
        created_at,
        invoice_items (
          id,
          line_no,
          description,
          quantity,
          unit_price
        )
      `
      )
      .eq("id", invoiceId)
      .single();

    if (invErr || !invoice) return res.status(404).send("Invoice not found");

const userId = userData.user.id;

const { data: member, error: memErr } = await supabase
  .from("workspace_members")
  .select("id")
  .eq("workspace_id", invoice.workspace_id)
  .eq("user_id", userId)
  .maybeSingle();

if (memErr) return res.status(500).send(`workspace_members lookup failed: ${memErr.message}`);
if (!member) return res.status(403).send("Forbidden: not a workspace member");


    // Sponsor
    const { data: sponsor } = invoice.sponsor_id
      ? await supabase.from("sponsors").select("id,name").eq("id", invoice.sponsor_id).maybeSingle()
      : { data: null };

    // Billing profile (if you created it)
    const { data: profile } = await supabase
      .from("workspace_billing_profiles")
      .select("*")
      .eq("workspace_id", invoice.workspace_id)
      .maybeSingle();

    // Bill-to contact: prefer is_billing
    const { data: contacts } = invoice.sponsor_id
      ? await supabase
          .from("contacts")
          .select("id,name,company,email,phone,role,is_billing")
          .eq("workspace_id", invoice.workspace_id)
          .eq("sponsor_id", invoice.sponsor_id)
          .order("created_at", { ascending: true })
      : { data: [] };

    const billTo =
      (contacts || []).find((c) => c.is_billing) ||
      (contacts || []).find((c) => (c.role || "").toLowerCase().includes("billing")) ||
      (contacts || [])[0] ||
      null;

    const items = [...(invoice.invoice_items || [])].sort(
      (a, b) => (a.line_no ?? 0) - (b.line_no ?? 0)
    );

    const pdfBytes = await buildInvoicePdf({ invoice, items, profile, sponsor, billTo });

    const filename = `Invoice-${invoice.invoice_number || invoice.id}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(Buffer.from(pdfBytes));
  } catch (e) {
    return res.status(500).send(e?.message || "Failed to generate PDF");
  }
}

async function buildInvoicePdf({ invoice, items, profile, sponsor, billTo }) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const margin = 50;
  let y = 750;

  const draw = (text, x = margin, size = 11, f = font) => {
    page.drawText(String(text ?? ""), { x, y, size, font: f });
    y -= size + 6;
  };

  // From (your billing profile)
  const fromName = profile?.business_name || profile?.contact_name || "Billing";
  draw(fromName, margin, 16, bold);

  const fromLines = [
    profile?.address_line1,
    profile?.address_line2,
    [profile?.city, profile?.state, profile?.postal_code].filter(Boolean).join(", "),
    profile?.country,
    profile?.email,
    profile?.phone,
    profile?.website,
  ].filter(Boolean);

  for (const line of fromLines) draw(line, margin, 10);

  // Right-side invoice info
  y = 750;
  const rightX = 360;
  page.drawText("INVOICE", { x: rightX, y, size: 18, font: bold });
  y -= 24;
  page.drawText(`Invoice #: ${invoice.invoice_number || ""}`, { x: rightX, y, size: 10, font });
  y -= 14;
  page.drawText(`Date: ${invoice.sent_date || invoice.created_at?.slice(0, 10) || ""}`, {
    x: rightX,
    y,
    size: 10,
    font,
  });
  y -= 14;
  page.drawText(`Status: ${invoice.status || "draft"}`, { x: rightX, y, size: 10, font });

  // Body start
  y = 640;

  // Bill To
  page.drawText("Bill To:", { x: margin, y, size: 12, font: bold });
  y -= 16;

  const billToLines = [];
  if (billTo?.company) billToLines.push(billTo.company);
  if (billTo?.name) billToLines.push(billTo.name);
  if (!billTo?.company && !billTo?.name && sponsor?.name) billToLines.push(sponsor.name);
  if (billTo?.email) billToLines.push(billTo.email);
  if (billTo?.phone) billToLines.push(billTo.phone);
  if (billToLines.length === 0) billToLines.push("—");

  for (const line of billToLines) {
    page.drawText(String(line).slice(0, 90), { x: margin, y, size: 10, font });
    y -= 12;
  }

  y -= 12;

  // Line items header
  page.drawText("Description", { x: margin, y, size: 10, font: bold });
  page.drawText("Qty", { x: 380, y, size: 10, font: bold });
  page.drawText("Unit", { x: 430, y, size: 10, font: bold });
  page.drawText("Amount", { x: 500, y, size: 10, font: bold });
  y -= 14;

  for (const it of items) {
    const qty = Number(it.quantity ?? 0);
    const unit = Number(it.unit_price ?? 0);
    const amt = qty * unit;

    page.drawText((it.description || "").slice(0, 60), { x: margin, y, size: 10, font });
    page.drawText(String(qty), { x: 380, y, size: 10, font });
    page.drawText(money(unit), { x: 430, y, size: 10, font });
    page.drawText(money(amt), { x: 500, y, size: 10, font });

    y -= 14;
    if (y < 160) break;
  }

  y -= 10;
  page.drawText(`Total: ${money(invoice.amount)}`, { x: 430, y, size: 12, font: bold });

  if (invoice.notes) {
    y -= 30;
    page.drawText("Notes:", { x: margin, y, size: 11, font: bold });
    y -= 14;
    page.drawText(invoice.notes.slice(0, 300), { x: margin, y, size: 10, font });
  }

  return await pdfDoc.save();
}

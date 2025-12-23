import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/router";
import TopNav from "@/components/TopNav";
import ui from "@/styles/ui.module.css";

export default function BillingSettings() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [workspaceId, setWorkspaceId] = useState(null);
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [profileId, setProfileId] = useState(null);

  // form
  const [businessName, setBusinessName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");

  const [address1, setAddress1] = useState("");
  const [address2, setAddress2] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [postal, setPostal] = useState("");
  const [country, setCountry] = useState("USA");

  const [paymentMethod, setPaymentMethod] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountName, setAccountName] = useState("");
  const [accountLast4, setAccountLast4] = useState("");
  const [routingNumber, setRoutingNumber] = useState("");
  const [instructions, setInstructions] = useState("");

  // auth bootstrap
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const u = data?.session?.user ?? null;
      setUser(u);
      if (!u) router.replace("/login");
    });
  }, [router]);

  async function loadWorkspaceId() {
    const { data } = await supabase
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })
      .limit(1);
    return data?.[0]?.workspace_id ?? null;
  }

  async function loadProfile(wsId) {
    const { data } = await supabase
      .from("workspace_billing_profiles")
      .select("*")
      .eq("workspace_id", wsId)
      .maybeSingle();

    if (!data) return;

    setProfileId(data.id);
    setBusinessName(data.business_name || "");
    setEmail(data.email || "");
    setPhone(data.phone || "");
    setWebsite(data.website || "");
    setAddress1(data.address_line1 || "");
    setAddress2(data.address_line2 || "");
    setCity(data.city || "");
    setState(data.state || "");
    setPostal(data.postal_code || "");
    setCountry(data.country || "");
    setPaymentMethod(data.payment_method || "");
    setBankName(data.bank_name || "");
    setAccountName(data.account_name || "");
    setAccountLast4(data.account_number_last4 || "");
    setRoutingNumber(data.routing_number || "");
    setInstructions(data.payment_instructions || "");
  }

  useEffect(() => {
    if (!user) return;
    (async () => {
      const wsId = await loadWorkspaceId();
      setWorkspaceId(wsId);
      if (wsId) await loadProfile(wsId);
    })();
  }, [user]);

  async function save(e) {
    e.preventDefault();
    if (!workspaceId) return;

    setSaving(true);
    setMsg("");

    const payload = {
      workspace_id: workspaceId,
      business_name: businessName || null,
      email: email || null,
      phone: phone || null,
      website: website || null,
      address_line1: address1 || null,
      address_line2: address2 || null,
      city,
      state,
      postal_code: postal,
      country,
      payment_method: paymentMethod || null,
      bank_name: bankName || null,
      account_name: accountName || null,
      account_number_last4: accountLast4 || null,
      routing_number: routingNumber || null,
      payment_instructions: instructions || null,
    }; 

const { error } = await supabase
  .from("workspace_billing_profiles")
  .upsert(payload, { onConflict: "workspace_id" });

    if (error) setMsg(error.message);
    else setMsg("Saved");

    setSaving(false);
  }

  if (!user) return null;

  return (
    <div className={ui.container}>
      <TopNav active="settings" />

      <h1 className={ui.h1}>Billing & Invoice Details</h1>
      {msg ? <div className={ui.notice}>{msg}</div> : null}

      <form onSubmit={save} className={ui.card}>
        <h3>From</h3>
        <input value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="Business / Athlete name" />
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" />
        <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="Website" />

        <h3>Address</h3>
        <input value={address1} onChange={(e) => setAddress1(e.target.value)} placeholder="Address line 1" />
        <input value={address2} onChange={(e) => setAddress2(e.target.value)} placeholder="Address line 2" />
        <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" />
        <input value={state} onChange={(e) => setState(e.target.value)} placeholder="State" />
        <input value={postal} onChange={(e) => setPostal(e.target.value)} placeholder="ZIP / Postal code" />
        <input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Country" />

        <h3>Payment</h3>
        <input value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} placeholder="ACH / Wire / Check" />
        <input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="Bank name" />
        <input value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder="Account name" />
        <input value={accountLast4} onChange={(e) => setAccountLast4(e.target.value)} placeholder="Account last 4" />
        <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Payment instructions" />

        <button className={`${ui.btn} ${ui.btnPrimary}`} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </form>
    </div>
  );
}

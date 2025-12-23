import { useRouter } from "next/router";
import { supabase } from "@/lib/supabaseClient";
import ui from "@/styles/ui.module.css";
import "@/styles/globals.css";

export default function TopNav({ active = "" }) {
  const router = useRouter();

  async function logout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  const NavLink = ({ id, label, href, primary = false }) => (
    <button
      type="button"
      onClick={() => router.push(href)}
      className={[
        ui.navLink,
        primary ? ui.navLinkPrimary : "",
        active === id ? ui.navLinkPrimary : "",
      ].join(" ")}
    >
      {label}
    </button>
  );

  return (
    <nav className={ui.nav}>
      <div className={ui.navInner}>
        {/* Brand */}
        <div className={ui.brand}>
          {/* <div className={ui.logo} /> */}
          <div>
            <div className={ui.brandTitle}>Athlete Portal</div>
            <div className={ui.brandSub}>Sponsorship management</div>
          </div>
        </div>

        {/* Links */}
        <div className={ui.navLinks}>
          <NavLink id="dashboard" label="Dashboard" href="/dashboard" />
          <NavLink id="obligations" label="Obligations" href="/obligations" />
          <NavLink id="invoices" label="Invoices" href="/invoices" />
          <NavLink id="contracts" label="Contracts" href="/contracts" />
          <NavLink id="sponsors" label="Sponsors" href="/sponsors" />
          <NavLink id="contacts" label="Contacts" href="/contacts" />

          <button
            type="button"
            onClick={logout}
            className={ui.navLink}
          >
            Logout
          </button>
        </div>
      </div>
    </nav>
  );
}

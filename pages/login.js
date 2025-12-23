import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/router";
import "@/styles/globals.css";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("");
  const router = useRouter();

  useEffect(() => {
    // If already logged in, go to dashboard
    supabase.auth.getSession().then(({ data }) => {
      if (data?.session) router.replace("/dashboard");
    });
  }, [router]);

  async function handleLogin(e) {
    e.preventDefault();
    setStatus("Sending magic link...");

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/dashboard`,
      },
    });

    setStatus(error ? error.message : "Check your email for the login link.");
  }

  return (
    <div style={{ maxWidth: 420, margin: "60px auto", padding: 16 }}>
      <h1>Login</h1>
      <form onSubmit={handleLogin}>
        <label>Email</label>
        <input
          style={{ width: "100%", padding: 10, marginTop: 8 }}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          placeholder="you@example.com"
          required
        />
        <button style={{ marginTop: 12, padding: 10, width: "100%" }}>
          Send magic link
        </button>
      </form>
      <p style={{ marginTop: 12 }}>{status}</p>
    </div>
  );
}

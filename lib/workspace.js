import { supabase } from "@/lib/supabaseClient";

// For now you only have 1 workspace, so we just grab the first membership.
// Later you can support multiple and let the user choose.
export async function getActiveWorkspaceId() {
  const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
  if (sessionErr) throw sessionErr;

  const user = sessionData?.session?.user;
  if (!user) return null;

  const { data, error } = await supabase
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) throw error;
  return data?.[0]?.workspace_id ?? null;
}

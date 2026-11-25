import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function isEmail(value: unknown): value is string {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ success: false, message: "Method not allowed." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = request.headers.get("Authorization") ?? "";
  const accessToken = authorization.replace(/^Bearer\s+/i, "").trim();

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ success: false, message: "The Supabase Edge Function is missing required server configuration." }, 500);
  }
  if (!accessToken) return json({ success: false, message: "Sign in as an administrator first." }, 401);

  const callerClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: callerData, error: callerError } = await callerClient.auth.getUser(accessToken);
  if (callerError || !callerData.user) {
    return json({ success: false, message: "Your session is invalid or has expired. Please sign in again." }, 401);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: callerProfile, error: profileError } = await admin
    .from("profiles")
    .select("id,role,active")
    .eq("id", callerData.user.id)
    .maybeSingle();

  if (profileError) return json({ success: false, message: profileError.message }, 500);
  if (!callerProfile || callerProfile.role !== "admin" || callerProfile.active === false) {
    return json({ success: false, message: "Only an active DIANE administrator can manage rider accounts." }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ success: false, message: "The request body must be valid JSON." }, 400);
  }

  const action = body.action;
  if (action === "create") {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!name || name.length > 80 || !isEmail(email) || !phone || phone.length > 30 || password.length < 8) {
      return json({ success: false, message: "Enter a valid name, email, phone number, and temporary password (at least 8 characters)." }, 400);
    }

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, role: "rider" },
    });
    if (createError || !created.user) {
      return json({ success: false, message: createError?.message ?? "Supabase could not create the rider account." }, 400);
    }

    const { error: insertError } = await admin.from("profiles").upsert({
      id: created.user.id,
      name,
      email,
      phone,
      role: "rider",
      active: true,
    });
    if (insertError) {
      // Roll back only the new Auth user created by this request.
      await admin.auth.admin.deleteUser(created.user.id);
      return json({ success: false, message: `The rider profile could not be created: ${insertError.message}` }, 500);
    }

    return json({ success: true, rider_id: created.user.id, message: "Rider account created successfully." });
  }

  const riderId = typeof body.rider_id === "string" ? body.rider_id : "";
  if (!riderId) return json({ success: false, message: "A rider account ID is required." }, 400);

  const { data: target, error: targetError } = await admin
    .from("profiles")
    .select("id,role,active")
    .eq("id", riderId)
    .maybeSingle();
  if (targetError) return json({ success: false, message: targetError.message }, 500);
  if (!target || target.role !== "rider") {
    return json({ success: false, message: "The selected profile is not a DIANE rider account." }, 404);
  }

  if (action === "update") {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    if (!name || name.length > 80 || !phone || phone.length > 30) {
      return json({ success: false, message: "Enter a valid rider name and contact number." }, 400);
    }
    const { error: updateError } = await admin
      .from("profiles")
      .update({ name, phone })
      .eq("id", riderId)
      .eq("role", "rider");
    if (updateError) return json({ success: false, message: updateError.message }, 500);
    return json({ success: true, rider_id: riderId, message: "Rider profile updated successfully." });
  }

  if (action === "set_active") {
    const active = body.active === true;
    if (!active) {
      const { data: openAssignments, error: assignmentError } = await admin
        .from("orders")
        .select("id")
        .eq("rider_id", riderId)
        .in("status", ["Shipped", "Out for Delivery"])
        .limit(1);
      if (assignmentError) return json({ success: false, message: assignmentError.message }, 500);
      if (openAssignments?.length) {
        return json({
          success: false,
          message: "This rider has an assigned order that is not yet delivered. Reassign or complete it before deactivating the account.",
        }, 409);
      }
    }

    const { error: updateError } = await admin
      .from("profiles")
      .update({ active })
      .eq("id", riderId)
      .eq("role", "rider");
    if (updateError) return json({ success: false, message: updateError.message }, 500);

    const { error: authUpdateError } = await admin.auth.admin.updateUserById(riderId, {
      ban_duration: active ? "none" : "876000h",
    });
    if (authUpdateError) {
      await admin.from("profiles").update({ active: target.active ?? true }).eq("id", riderId).eq("role", "rider");
      return json({ success: false, message: `The profile status was rolled back because Supabase Auth could not update the account: ${authUpdateError.message}` }, 500);
    }

    return json({
      success: true,
      rider_id: riderId,
      message: active ? "Rider account reactivated." : "Rider account deactivated.",
    });
  }

  return json({ success: false, message: "Unsupported rider account action." }, 400);
});

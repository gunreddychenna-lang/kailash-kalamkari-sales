"use strict";

// KK-CEO-003 isolated Supabase Auth adapter.
// Database RLS must independently protect all business tables.
(function (root) {
  async function signOut(client) {
    const { error } = await client.auth.signOut();
    if (error) throw error;
  }

  async function getStaff(client) {
    // getUser checks identity with Supabase Auth.
    const { data: authData, error: authError } =
      await client.auth.getUser();

    if (authError || !authData?.user?.id) return null;

    const { data, error } = await client
      .from("kk_staff_access")
      .select(
        "auth_user_id,login_id,display_name,employee_id,role,stores,features,active"
      )
      .eq("auth_user_id", authData.user.id)
      .maybeSingle();

    if (error || !data || data.active !== true) return null;

    // Defense in depth: verify the retrieved row matches Auth.
    if (data.auth_user_id !== authData.user.id) return null;

    if (!root.KKPermissions?.ROLE_FEATURES?.[data.role]) {
      return null;
    }

    return {
      valid: true,
      authUserId: authData.user.id,
      user: data.login_id,
      displayName: data.display_name,
      empId: data.employee_id || "",
      role: data.role,
      stores: data.stores || [],
      features: root.KKPermissions.enabledFeatures(data),
      active: true
    };
  }

  async function login(client, email, password) {
    const identifier = String(email || "").trim();
    if (!identifier || !password) {
      throw new Error("Email and password are required.");
    }

    const { error } = await client.auth.signInWithPassword({
      email: identifier,
      password
    });

    if (error) throw new Error("Invalid credentials.");

    const profile = await getStaff(client);
    if (!profile) {
      await signOut(client);
      throw new Error("Your staff account is not authorized.");
    }

    return profile;
  }

  const api = Object.freeze({ login, getStaff, signOut });

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  root.KKSecureAuth = api;
})(
  typeof window !== "undefined"
    ? window
    : globalThis
);

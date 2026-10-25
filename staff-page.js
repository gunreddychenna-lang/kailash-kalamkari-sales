"use strict";

(async function () {
  const $ = id => document.getElementById(id);
  const message = $("message");
  const workspace = $("workspace");
  const permissions = window.KKPermissions;

  function status(text, error = false) {
    message.textContent = text;
    message.style.color = error ? "#991b1b" : "#14532d";
  }

  function makeCheckboxes(container, items, selected = []) {
    container.replaceChildren();

    for (const item of items) {
      const label = document.createElement("label");
      label.className = "flex items-center gap-2 text-sm";

      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = item;
      input.checked = selected.includes(item);

      const span = document.createElement("span");
      span.textContent = item.replaceAll("_", " ");

      label.append(input, span);
      container.append(label);
    }
  }

  function checked(container) {
    return [...container.querySelectorAll("input:checked")]
      .map(input => input.value);
  }

  if (!window.supabase?.createClient ||
      !window.KKSecureAuth ||
      !permissions ||
      !window.KK_STAFF_CONFIG) {
    status("Required authentication modules unavailable.", true);
    return;
  }

  const config = window.KK_STAFF_CONFIG;
  const client = window.supabase.createClient(
    config.url,
    config.anonKey
  );

  try {
    const profile = await window.KKSecureAuth.getStaff(client);

    if (!profile || !permissions.fullAccess(profile)) {
      status("Access denied. Owner/Admin account required.", true);
      return;
    }

    workspace.classList.remove("hidden");
    status("Signed in as " + profile.displayName);

  } catch (error) {
    status("Unable to validate staff session.", true);
    return;
  }

  async function api(method, body) {
    const { data, error } = await client.auth.getSession();

    const token = data?.session?.access_token;
    if (error || !token) {
      throw new Error("Session expired. Please log in again.");
    }

    const response = await fetch("/api/staff", {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json"
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result.error || "Request failed.");
    }

    return result;
  }

  const stores = permissions.ALL_STORES;
  const features = permissions.ALL_FEATURES.filter(
    item => item !== "staff_management"
  );

  makeCheckboxes($("create-stores"), stores);
  makeCheckboxes($("create-features"), features);

  async function loadEmployees() {
    status("Loading employee accounts...");

    try {
      const result = await api("GET");
      const container = $("employees");
      container.replaceChildren();

      for (const employee of result.employees || []) {
        const card = document.createElement("article");
        card.className = "border rounded-xl p-4 space-y-3";

        const heading = document.createElement("h3");
        heading.className = "font-bold";
        heading.textContent =
          employee.display_name + " (" + employee.login_id + ")";

        const info = document.createElement("p");
        info.className = "text-sm text-stone-500";
        info.textContent = employee.active
          ? "Account active"
          : "Account deactivated";

        const storeBox = document.createElement("div");
        storeBox.className = "flex flex-wrap gap-3";

        const featureBox = document.createElement("div");
        featureBox.className = "grid grid-cols-2 sm:grid-cols-4 gap-2";

        makeCheckboxes(storeBox, stores, employee.stores || []);
        makeCheckboxes(featureBox, features, employee.features || []);

        const save = document.createElement("button");
        save.className =
          "bg-[#5C0612] text-white rounded-lg px-4 py-2 text-sm";
        save.textContent = "Save Permissions";

        save.addEventListener("click", async () => {
          save.disabled = true;
          try {
            await api("PATCH", {
              id: employee.id,
              stores: checked(storeBox),
              features: checked(featureBox)
            });
            status("Permissions updated for " + employee.login_id);
          } catch (error) {
            status(error.message, true);
          } finally {
            save.disabled = false;
          }
        });

        const toggle = document.createElement("button");
        toggle.className =
          "border border-[#5C0612] rounded-lg px-4 py-2 text-sm";
        toggle.textContent = employee.active
          ? "Deactivate"
          : "Activate";

        toggle.addEventListener("click", async () => {
          const newActive = !employee.active;

          if (!confirm(
            (newActive ? "Activate " : "Deactivate ") +
            employee.login_id + "?"
          )) return;

          toggle.disabled = true;
          try {
            await api("PATCH", {
              id: employee.id,
              active: newActive
            });
            await loadEmployees();
          } catch (error) {
            status(error.message, true);
            toggle.disabled = false;
          }
        });

        const actions = document.createElement("div");
        actions.className = "flex gap-3 flex-wrap";
        actions.append(save, toggle);

        card.append(heading, info, storeBox, featureBox, actions);
        container.append(card);
      }

      if (!result.employees?.length) {
        container.textContent = "No employee accounts found.";
      }

      status("Employee accounts loaded.");
    } catch (error) {
      status(error.message, true);
    }
  }

  $("create-form").addEventListener("submit", async event => {
    event.preventDefault();

    const button = $("create-button");
    button.disabled = true;

    try {
      await api("POST", {
        loginId: $("login-id").value.trim().toLowerCase(),
        displayName: $("display-name").value.trim(),
        email: $("email").value.trim().toLowerCase(),
        password: $("password").value,
        stores: checked($("create-stores")),
        features: checked($("create-features"))
      });

      $("create-form").reset();
      $("password").value = "";
      await loadEmployees();
      status("Employee account created.");
    } catch (error) {
      status(error.message, true);
    } finally {
      button.disabled = false;
    }
  });

  $("refresh-button").addEventListener("click", loadEmployees);

  await loadEmployees();
})();
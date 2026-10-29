"use strict";

(async () => {
  const el = id => document.getElementById(id);
  const selected = new Map();
  let client;
  let page = 1;

  const money = value =>
    Number(value).toLocaleString("en-IN", {
      style: "currency",
      currency: "INR"
    });

  function renderSelected() {
    const body = el("bulk-selected");
    body.replaceChildren();

    for (const [key, bill] of selected) {
      const tr = document.createElement("tr");

      for (const value of [
        `${bill.bill_no} (${bill.branch})`,
        money(bill.bill_amount)
      ]) {
        const td = document.createElement("td");
        td.textContent = value;
        tr.append(td);
      }

      const td = document.createElement("td");
      const button = document.createElement("button");
      button.textContent = "Remove";
      button.type = "button";
      button.onclick = () => {
        selected.delete(key);
        renderSelected();
        renderResults();
      };
      td.append(button);
      tr.append(td);
      body.append(tr);
    }

    el("bulk-count").textContent =
      `${selected.size} invoice(s) selected`;
  }

  let visible = [];

  function renderResults() {
    const body = el("bulk-results");
    body.replaceChildren();

    for (const bill of visible) {
      const key = JSON.stringify([
        bill.branch, bill.bill_no, bill.bill_date
      ]);

      const tr = document.createElement("tr");
      const td = document.createElement("td");
      const checkbox = document.createElement("input");

      checkbox.type = "checkbox";
      checkbox.checked = selected.has(key);
      checkbox.disabled = !bill.bill_no || !bill.branch;

      checkbox.onchange = () => {
        if (checkbox.checked) {
          if (selected.size >= 100) {
            checkbox.checked = false;
            alert("Maximum 100 invoices per draft.");
            return;
          }
          selected.set(key, bill);
        } else {
          selected.delete(key);
        }
        renderSelected();
      };

      td.append(checkbox);
      tr.append(td);

      for (const value of [
        bill.bill_no,
        bill.branch,
        bill.bill_date,
        money(bill.bill_amount)
      ]) {
        const cell = document.createElement("td");
        cell.textContent = value ?? "";
        tr.append(cell);
      }

      body.append(tr);
    }
  }

  async function search(next = false) {
    if (!client) return;
    if (!next) page = 1;

    const { data } = await client.auth.getSession();
    const token = data?.session?.access_token;

    if (!token) throw new Error("Sign in required");

    const params = new URLSearchParams({
      search: el("bulk-query").value.trim(),
      branch: el("bulk-branch").value,
      page: String(page)
    });

    const response = await fetch(
      "/api/payment-invoices?" + params,
      {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store"
      }
    );

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Search failed");
    }

    visible = result.invoices;
    renderResults();
    el("bulk-next").hidden = !result.has_more;
  }

  async function run(next) {
    const button = el("bulk-find");
    button.disabled = true;
    try {
      await search(next);
    } catch (error) {
      alert(error.message);
    } finally {
      button.disabled = false;
    }
  }

  el("bulk-find").onclick = () => run(false);
  el("bulk-next").onclick = () => {
    page++;
    run(true);
  };

  try {
    client = supabase.createClient(
      KK_STAFF_CONFIG.url,
      KK_STAFF_CONFIG.anonKey
    );
    const profile = await KK.session(client);
    if (!profile) throw new Error("Owner/Admin login required");
    await run(false);
  } catch (error) {
    el("bulk-count").textContent = error.message;
  }
})();
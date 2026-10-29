"use strict";

(async () => {
  const el = id => document.getElementById(id);
  const drafts = new Map();
  let client, page = 1, rows = [], sortBy = "bill", descending = false;

  const money = value =>
    Number(value).toLocaleString("en-IN", {
      style: "currency", currency: "INR"
    });

  const keyOf = bill =>
    JSON.stringify([bill.branch, bill.bill_no, bill.bill_date]);

  function cell(tr, value, className = "") {
    const td = document.createElement("td");
    td.className = className;
    td.textContent = value ?? "";
    tr.append(td);
    return td;
  }

  function updateDraftCount() {
    el("draft-count").textContent =
      `${drafts.size} draft bill(s) — unsaved`;
  }

  function createLedger(bill) {
    const key = keyOf(bill);
    const container = document.createElement("div");
    container.className = "ledger-details";

    const warning = document.createElement("p");
    warning.className = "small";
    warning.textContent =
      "Draft only. Historical paid amount and balance are not verified.";
    container.append(warning);

    const items = document.createElement("div");
    container.append(items);

    const add = document.createElement("button");
    add.type = "button";
    add.textContent = "+ Add Payment Method";

    function addMethod() {
      const line = document.createElement("div");
      line.className = "ledger-row";

      const method = document.createElement("select");
      for (const name of ["Select Method","UPI Store","UPI Online","Card","Cash"]) {
        const option = document.createElement("option");
        option.value = name === "Select Method" ? "" : name;
        option.textContent = name;
        method.append(option);
      }

      const account = document.createElement("select");
      const bankNames = [
        "Select Account","42441-TJ","Kailash Kalamkari",
        "KC","Paytm","SBI","T Dhanalakshmi",
        "T Janakamma","T KAILASAM"
      ];

      function fillAccounts() {
        account.replaceChildren();
        const names = method.value === "Cash" ? ["Cash"] : bankNames;
        for (const name of names) {
          const option = document.createElement("option");
          option.value = name === "Select Account" ? "" : name;
          option.textContent = name;
          account.append(option);
        }
      }

      method.addEventListener("change", fillAccounts);
      fillAccounts();

      const amount = document.createElement("input");
      amount.type = "number";
      amount.min = "0.01";
      amount.step = "0.01";
      amount.placeholder = "Amount";

      const reference = document.createElement("input");
      reference.placeholder = "UTR / RRN / Reference";
      reference.maxLength = 120;

      for (const control of [method,account,amount,reference]) {
        control.addEventListener("change", () => {
          drafts.set(key, true);
          updateDraftCount();
        });
        line.append(control);
      }

      items.append(line);
    }

    add.onclick = addMethod;
    container.append(add);
    addMethod();

    return container;
  }

  function render() {
    const tbody = el("invoice-rows");
    tbody.replaceChildren();

    const values = [...rows].sort((a,b) => {
      let x, y;
      if (sortBy === "amount") {
        x = Number(a.bill_amount);
        y = Number(b.bill_amount);
        return descending ? y - x : x - y;
      }
      const fields = {
        agent: "sm_name",
        channel: "channel",
        bill: "bill_no"
      };
      x = String(a[fields[sortBy]] || "");
      y = String(b[fields[sortBy]] || "");
      return (descending ? -1 : 1) * x.localeCompare(y);
    });

    for (const bill of values) {
      const tr = document.createElement("tr");
      cell(tr, bill.sm_name || "—");
      cell(tr, bill.channel || "—");
      cell(tr, bill.bill_no);
      cell(tr, money(bill.bill_amount), "amount");

      const td = document.createElement("td");
      td.className = "ledger";

      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.textContent = "View / Enter Payments";

      const details = createLedger(bill);
      details.hidden = true;

      toggle.onclick = () => {
        details.hidden = !details.hidden;
      };

      td.append(toggle, details);
      tr.append(td);
      tbody.append(tr);
    }
  }

  async function load() {
    el("status").textContent = "Loading invoices...";
    const {data} = await client.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) throw new Error("Sign in required.");

    const query = new URLSearchParams({
      branch: el("store").value,
      search: el("search").value.trim(),
      page: String(page)
    });

    const response = await fetch("/api/payment-invoices?" + query, {
      cache: "no-store",
      headers: {Authorization: `Bearer ${token}`}
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Invoice lookup failed");

    rows = result.invoices;
    render();
    el("next").disabled = !result.has_more;
    el("status").textContent =
      `${rows.length} invoices loaded. Page ${page}. Draft only.`;
  }

  el("find").onclick = async () => {
    page = 1;
    try { await load(); }
    catch(e) { el("status").textContent = e.message; }
  };

  el("next").onclick = async () => {
    page++;
    try { await load(); }
    catch(e) {
      page--;
      el("status").textContent = e.message;
    }
  };

  el("store").onchange = () => el("find").click();

  for (const button of document.querySelectorAll("[data-sort]")) {
    button.onclick = () => {
      const target = button.dataset.sort;
      descending = sortBy === target ? !descending : false;
      sortBy = target;
      render();
    };
  }

  try {
    client = supabase.createClient(
      KK_STAFF_CONFIG.url,
      KK_STAFF_CONFIG.anonKey
    );
    const profile = await KK.session(client);
    if (!profile) throw new Error("Owner/Admin login required.");
    await load();
  } catch(e) {
    el("status").textContent = e.message;
  }
})();
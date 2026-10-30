"use strict";

(async () => {
  const el = id => document.getElementById(id);
  const drafts = new Map();

  let client;
  let page = 1;
  let rows = [];
  let sortBy = "bill";
  let descending = false;

  let bankAccounts = [];

  const allAccounts = () => bankAccounts;

  async function bankRequest(method = "GET", body) {
    const { data } = await client.auth.getSession();
    const token = data?.session?.access_token;

    if (!token) throw new Error("Login required");

    const response = await fetch("/api/payment-accounts", {
      method,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Bank request failed");
    }

    return result;
  }

  async function refreshBankAccounts() {
    const result = await bankRequest();

    if (!Array.isArray(result.accounts)) {
      throw new Error("Invalid bank list");
    }

    bankAccounts = result.accounts;
    render();
  }
  const money = value =>
    Number(value).toLocaleString("en-IN", {
      style: "currency",
      currency: "INR"
    });

  const keyOf = bill =>
    JSON.stringify([bill.branch, bill.bill_no, bill.bill_date]);

  const newSplit = () => ({
    amount: "",
    bank: "",
    method: "",
    reference: ""
  });

  function getDraft(bill) {
    const key = keyOf(bill);

    if (!drafts.has(key)) {
      drafts.set(key, {
        bill,
        splits: [newSplit()]
      });
    }

    return drafts.get(key);
  }

  function activeDraftCount() {
    return [...drafts.values()].filter(d =>
      d.splits.some(s =>
        s.amount !== "" ||
        s.method !== "" ||
        s.bank !== "" ||
        s.reference !== ""
      )
    ).length;
  }

  function updateCount() {
    el("draft-count").textContent =
      `${activeDraftCount()} edited bill(s) — NOT SAVED`;
  }

  function addCell(tr, value, className = "") {
    const td = document.createElement("td");
    td.className = className;
    td.textContent = value ?? "";
    tr.append(td);
    return td;
  }

  function createSelect(options, value, onChange) {
    const select = document.createElement("select");

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select";
    select.append(placeholder);

    for (const name of options) {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      select.append(option);
    }

    select.value = value || "";
    select.addEventListener("change", () => {
      onChange(select.value);
      updateCount();
    });

    return select;
  }

  function input(value, placeholder, onChange, type = "text") {
    const control = document.createElement("input");

    control.type = type;
    control.value = value ?? "";
    control.placeholder = placeholder;

    if (type === "number") {
      control.min = "0.01";
      control.step = "0.01";
    } else {
      control.maxLength = 120;
    }

    control.addEventListener("input", () => {
      onChange(control.value);
      updateCount();
    });

    return control;
  }

  function addSplitLine(bill, split, index) {
    const tr = document.createElement("tr");
    const draft = getDraft(bill);

    addCell(tr, "↳ Additional payment");
    addCell(tr, bill.channel || "—");
    addCell(tr, bill.bill_no);
    addCell(tr, money(bill.bill_amount), "amount");
      addCell(
        tr,
        bill.original_payment_type || "Not available in source"
      );

    const amountCell = document.createElement("td");
    amountCell.append(
      input(split.amount, "Received ₹", v => {
        split.amount = v;
        updateLedger(bill);
      }, "number")
    );
    tr.append(amountCell);

    const bankCell = document.createElement("td");
    const methodCell = document.createElement("td");

    function bankOptions() {
      return split.method === "Cash"
        ? ["Cash"]
        : allAccounts();
    }

    function redrawBank() {
      const select = createSelect(
        bankOptions(),
        split.bank,
        v => { split.bank = v; }
      );
      bankCell.replaceChildren(select);
    }

    const method = createSelect(
      ["UPI Store", "UPI Online", "Card", "Cash"],
      split.method,
      v => {
        split.method = v;
        split.bank = v === "Cash" ? "Cash" : "";
        redrawBank();
        updateLedger(bill);
      }
    );

    methodCell.append(method);
    redrawBank();

    tr.append(bankCell, methodCell);

    const refCell = document.createElement("td");
    refCell.append(
      input(split.reference, "UTR / RRN", v => {
        split.reference = v;
      })
    );
    tr.append(refCell);

    const action = document.createElement("td");
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove Split";

    remove.onclick = () => {
      draft.splits.splice(index, 1);
      render();
      updateCount();
    };

    action.append(remove);
    tr.append(action);

    return tr;
  }

  function updateLedger(bill) {
    const draft = getDraft(bill);
    const total = draft.splits.reduce((sum, split) => {
      const n = Number(split.amount);
      return sum + (Number.isFinite(n) && n > 0 ? n : 0);
    }, 0);

    const node = document.getElementById(
      "ledger-" + encodeKey(keyOf(bill))
    );

    if (node) {
      node.textContent =
        `Draft: ${money(total)} / Bill: ${money(bill.bill_amount)}`;
    }
  }

  function encodeKey(value) {
    return Array.from(value)
      .map(ch => ch.charCodeAt(0).toString(16).padStart(4, "0"))
      .join("");
  }

  function render() {
    const tbody = el("invoice-rows");
    tbody.replaceChildren();

    const values = [...rows].sort((a, b) => {
      if (sortBy === "amount") {
        const difference =
          Number(a.bill_amount) - Number(b.bill_amount);
        return descending ? -difference : difference;
      }

      const fields = {
        agent: "sm_name",
        channel: "channel",
        bill: "bill_no"
      };

      const x = String(a[fields[sortBy]] || "");
      const y = String(b[fields[sortBy]] || "");

      return (descending ? -1 : 1) * x.localeCompare(y);
    });

    for (const bill of values) {
      const draft = getDraft(bill);
      const tr = document.createElement("tr");

      addCell(tr, bill.sm_name || "—");
      addCell(tr, bill.channel || "—");
      addCell(tr, bill.bill_no);
      addCell(tr, money(bill.bill_amount), "amount");
      addCell(
        tr,
        bill.original_payment_type || "Not available in source"
      );

      const split = draft.splits[0] || newSplit();
      if (!draft.splits.length) draft.splits.push(split);

      const amountCell = document.createElement("td");
      amountCell.append(
        input(split.amount, "Amount ₹", v => {
          split.amount = v;
          updateLedger(bill);
        }, "number")
      );
      tr.append(amountCell);

      const bankCell = document.createElement("td");
      const methodCell = document.createElement("td");

      function bankOptions() {
        return split.method === "Cash"
          ? ["Cash"]
          : allAccounts();
      }

      function redrawBank() {
        bankCell.replaceChildren(
          createSelect(bankOptions(), split.bank, v => {
            split.bank = v;
          })
        );
      }

      const method = createSelect(
        ["UPI Store", "UPI Online", "Card", "Cash"],
        split.method,
        v => {
          split.method = v;
          split.bank = v === "Cash" ? "Cash" : "";
          redrawBank();
          updateLedger(bill);
        }
      );

      methodCell.append(method);
      redrawBank();

      tr.append(bankCell, methodCell);

      const refCell = document.createElement("td");
      refCell.append(
        input(split.reference, "UTR / RRN", v => {
          split.reference = v;
        })
      );
      tr.append(refCell);

      const ledgerCell = document.createElement("td");
      const summary = document.createElement("div");
      summary.id = "ledger-" + encodeKey(keyOf(bill));

      const add = document.createElement("button");
      add.type = "button";
      add.textContent = "+ Add Split";

      add.onclick = () => {
        if (draft.splits.length >= 20) {
          el("status").textContent =
            "Maximum 20 payment splits per invoice.";
          return;
        }
        draft.splits.push(newSplit());
        render();
        updateCount();
      };

      ledgerCell.append(summary, add);

      const warning = document.createElement("div");
      warning.className = "small";
      warning.textContent = "Unverified opening balance";
      ledgerCell.append(warning);

      tr.append(ledgerCell);
      tbody.append(tr);
      updateLedger(bill);

      draft.splits.slice(1).forEach((extra, i) => {
        tbody.append(addSplitLine(bill, extra, i + 1));
      });
    }

    updateCount();
  }

  async function load() {
    el("status").textContent = "Loading invoices...";

    const { data } = await client.auth.getSession();
    const token = data?.session?.access_token;

    if (!token) throw new Error("Sign in required");

    const query = new URLSearchParams({
      search: el("search").value.trim(),
      branch: el("store").value,
      page: String(page)
    });

    const response = await fetch(
      "/api/payment-invoices?" + query,
      {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Failed to load bills");
    }

    rows = result.invoices;
    render();

    el("next").disabled = !result.has_more;
    el("status").textContent =
      `${rows.length} bills loaded. Page ${page}. Preview drafts only.`;
  }

  el("add-bank").onclick = async () => {
    const name = prompt("New bank / settlement account name:");
    if (name === null) return;

    const value = name.trim();

    if (!/^[A-Za-z0-9 ._-]{2,60}$/.test(value)) {
      alert("Enter valid account name (2-60 characters).");
      return;
    }

    const button = el("add-bank");
    button.disabled = true;

    try {
      await bankRequest("POST", { account_name: value });
      await refreshBankAccounts();

      el("status").textContent =
        `${value} saved in DEV bank accounts database.`;
    } catch (error) {
      el("status").textContent = error.message;
      alert(error.message);
    } finally {
      button.disabled = false;
    }
  };
  el("find").onclick = async () => {
    page = 1;
    try {
      await load();
    } catch (error) {
      el("status").textContent = error.message;
    }
  };

  el("next").onclick = async () => {
    page++;
    try {
      await load();
    } catch (error) {
      page--;
      el("status").textContent = error.message;
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

    if (!profile || !["owner", "admin"].includes(profile.secureRole)) {
      throw new Error("Owner/Admin access required");
    }

    await refreshBankAccounts();
    await load();
  } catch (error) {
    el("status").textContent = error.message;
  }
})();
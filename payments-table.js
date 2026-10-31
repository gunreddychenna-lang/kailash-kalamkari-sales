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
        : split.method === "Take By Hand" ? ["Take By Hand"] : allAccounts();
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
      ["UPI Store", "UPI Online", "Card", "Cash", ...(isProd() ? ["Take By Hand"] : [])],
      split.method,
      v => {
        split.method = v;
        split.bank = v === "Cash" ? "Cash" : v === "Take By Hand" ? "Take By Hand" : "";
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

  const DEV_URL = "https://yiaipfquxyrqxvkvjykp.supabase.co";
  const isDev = () => {
    const configured = String(KK_STAFF_CONFIG?.url || "")
      .replace(/\/$/, "");
    const host = location.hostname.toLowerCase();

    return configured === DEV_URL &&
      host.endsWith(".vercel.app") &&
      host.startsWith("kailash-kalamkari-sales-");
  };

  const PROD_URL = "https://dqvqqrbvklpiibzqivbp.supabase.co";

  const isProd = () => {
    const configured = String(KK_STAFF_CONFIG?.url || "")
      .replace(/\/$/, "");
    return configured === PROD_URL &&
      location.hostname.toLowerCase() === "kailash-kalamkari-sales.vercel.app";
  };

  const canPreparePayments = () => isDev() || isProd();

  function saveStatus(message) {
    const status = el("status");
    status.textContent = message;
    status.scrollIntoView({
      behavior: "smooth",
      block: "center"
    });
  }

  const todayIST = () => {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date());

    const get = type => parts.find(p => p.type === type).value;
    return `${get("year")}-${get("month")}-${get("day")}`;
  };

  const methodCodes = {
    "UPI Store": "UPI_STORE",
    "UPI Online": "UPI_ONLINE",
    "Card": "CARD", "Take By Hand": "TBH"
  };

  async function receiptRequest(method, payload) {
    const { data } = await client.auth.getSession();
    const token = data?.session?.access_token;

    if (!token) throw new Error("Login required");

    const url = method === "GET"
      ? "/api/payments?" + new URLSearchParams(payload)
      : "/api/payments";

    const response = await fetch(url, {
      method,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(method === "POST"
          ? { "Content-Type": "application/json" }
          : {})
      },
      ...(method === "POST"
        ? { body: JSON.stringify(payload) }
        : {})
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Receipt request failed");
    }

    return result;
  }

  function preparedDraft(draft) {
    const bill = draft.bill;

    if (!(isDev()
      ? /^TEST-[A-Za-z0-9_-]+$/.test(bill.bill_no)
      : isProd() && /^[A-Za-z0-9_-]{1,64}$/.test(bill.bill_no))) {
      throw new Error("Only DEV TEST invoices can be saved.");
    }

    const payments = draft.splits.filter(s =>
      [s.amount, s.bank, s.method, s.reference]
        .some(v => String(v || "").trim())
    ).map(s => {
      const amount = String(s.amount || "").trim();

      if (!/^[0-9]+(?:\.[0-9]{1,2})?$/.test(amount) ||
          Number(amount) <= 0) {
        throw new Error(`${bill.bill_no}: Invalid received amount`);
      }

      if (!s.method) {
        throw new Error(`${bill.bill_no}: Select Received Via`);
      }

      if (s.method === "Cash") {
        if (s.bank !== "Cash") {
          throw new Error(`${bill.bill_no}: Cash account mismatch`);
        }
      } else if (s.method === "Take By Hand") {
        if (s.bank !== "Take By Hand") {
          throw new Error(`${bill.bill_no}: Take By Hand account mismatch`);
        }
      } else if (
        !methodCodes[s.method] ||
        !bankAccounts.includes(s.bank) ||
        !String(s.reference || "").trim()
      ) {
        throw new Error(
          `${bill.bill_no}: Select valid bank and UTR/RRN`
        );
      }

      return {
        account: s.method === "Cash"
          ? "Cash"
          : s.method === "Take By Hand"
          ? "TBH::Take By Hand"
          : `${methodCodes[s.method]}::${s.bank}`,
        amount,
        payment_date: todayIST(),
        reference: String(s.reference || "").trim()
      };
    });

    if (!payments.length) {
      throw new Error(`${bill.bill_no}: No payment entered`);
    }

    const totalCents = payments.reduce(
      (sum, p) => sum + Math.round(Number(p.amount) * 100), 0
    );

    if (totalCents > Math.round(Number(bill.bill_amount) * 100)) {
      throw new Error(`${bill.bill_no}: Amount exceeds bill total`);
    }

    return {
      bill_no: bill.bill_no,
      branch: bill.branch,
      expected_bill_amount: bill.bill_amount,
      payments
    };
  }

  async function approveOpening(bill, panel) {
    if (!canPreparePayments() ||
        (isDev() && !/^TEST-[A-Za-z0-9_-]+$/.test(bill.bill_no))) {
      saveStatus("Opening approval unavailable for this invoice.");
      return;
    }

    const amount = prompt(
      `Verified opening paid for ${bill.bill_no} (₹):`
    );

    if (amount === null) return;

    if (!/^[0-9]+(?:\.[0-9]{1,2})?$/.test(amount.trim())) {
      saveStatus("Enter a valid amount with maximum 2 decimals.");
      return;
    }

    const evidence = prompt(
      "Evidence reference (receipt, register or verification note):"
    );

    if (evidence === null) return;

    if (evidence.trim().length < 3 ||
        evidence.trim().length > 500) {
      saveStatus("Evidence reference must be 3–500 characters.");
      return;
    }

    if (!confirm(
      `Approve ${bill.bill_no} opening paid ₹${amount}? ` +
      "This approval is immutable and cannot be edited in this screen."
    )) return;

    try {
      const { data } = await client.auth.getSession();
      const token = data?.session?.access_token;

      if (!token) throw new Error("Login required");

      const response = await fetch("/api/payment-opening", {
        method: "POST",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          bill_no: bill.bill_no,
          branch: bill.branch,
          opening_paid: amount.trim(),
          evidence: evidence.trim()
        })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Approval failed");
      }

      saveStatus(
        `${bill.bill_no}: Opening paid ${money(result.opening_paid)} ` +
        "approved successfully."
      );

      await viewHistory(bill, panel);

    } catch (error) {
      saveStatus(`${bill.bill_no}: ${error.message}`);
    }
  }
  async function viewHistory(bill, target) {
    target.textContent = "Loading saved receipts...";

    try {
      const result = await receiptRequest("GET", {
        bill_no: bill.bill_no,
        branch: bill.branch
      });

      target.replaceChildren();

      const heading = document.createElement("strong");
      heading.textContent = result.opening_approved === true
        ? `Opening Paid: ${money(result.opening_paid)} | ` +
          `New Receipts: ${money(result.paid_amount)} | ` +
          `Balance: ${money(result.balance)}`
        : `Opening Balance: NEEDS REVIEW | ` +
          `New Receipts: ${money(result.paid_amount)}`;
      target.append(heading);

      const paid = Math.round(Number(result.paid_amount) * 100);
      const balance = Math.round(Number(result.balance) * 100);
      const total = Math.round(Number(result.bill_amount) * 100);

      const status = document.createElement("div");
      status.className = "small";

      if (
        result.opening_approved !== true ||
        ![paid, balance, total].every(Number.isSafeInteger) ||
        paid < 0 || balance < 0 || total <= 0 ||
        paid + Math.round(Number(result.opening_paid) * 100) + balance !== total
      ) {
        status.textContent = result.opening_approved !== true
          ? "NEEDS REVIEW — Opening approval required"
          : "NEEDS REVIEW — Ledger mismatch";
      } else if (balance === 0) {
        status.textContent = (isDev() ? "SETTLED — DEV receipts" : "SETTLED — Production receipts");
      } else {
        status.textContent = (isDev() ? "PENDING — DEV receipts" : "PENDING — Production receipts");
      }

      target.append(status);

      const openingButton =
        target.parentElement?.querySelector(".opening-approval-button");
      const openingWarning =
        target.parentElement?.querySelector(".opening-status");

      if (openingButton && openingWarning) {
        const approved = result.opening_approved === true;
        openingButton.disabled = approved;
        openingButton.textContent = approved
          ? "Opening Approved"
          : (isDev() ? "Approve Opening (DEV)" : "Approve Opening");
        openingWarning.textContent = approved
          ? "Opening balance verified"
          : "Opening approval required";
      }

      const history = Array.isArray(result.history)
        ? result.history
        : [];

      if (!history.length) {
        const empty = document.createElement("p");
        empty.textContent = (isDev() ? "No DEV receipts saved for this bill." : "No Production receipts saved for this bill.");
        target.append(empty);
        return result;
      }

      for (const batch of history) {
        for (const receipt of (batch.payments || [])) {
          const line = document.createElement("p");
          line.className = "small";
          line.textContent = [
            receipt.payment_date,
            receipt.account,
            money(receipt.amount),
            receipt.reference || "No reference"
          ].join(" | ");
          target.append(line);
        }
      }
      return result;
    } catch (error) {
      target.textContent = `Ledger unavailable: ${error.message}`; return null;
    }
  }

  async function saveAllDev() {
    if (!canPreparePayments()) {
      saveStatus("Save blocked: unverified environment.");
      return;
    }

    const changed = [...drafts.values()].filter(d =>
      d.splits.some(s =>
        [s.amount, s.bank, s.method, s.reference]
          .some(v => String(v || "").trim())
      )
    );

    if (!changed.length) {
      el("status").textContent = "No payment drafts to save.";
      return;
    }

    let submissions;

    try {
      submissions = changed.map(d => ({
        draft: d,
        payload: preparedDraft(d)
      }));
    } catch (error) {
      saveStatus(error.message);
      return;
    }

    // Confirm explicitly before modifying DEV receipt records.
    if (!confirm(
      `Save payments for ${submissions.length} ${isDev() ? "DEV TEST" : "PRODUCTION"} bills? ` +
      "Each bill saves separately. Do not close the page."
    )) return;

    const saveButton = el("save-all");
    saveButton.disabled = true;

    let saved = 0;

    for (const item of submissions) {
      const bill = item.draft.bill;

      try {
        // Reuse the same idempotency key for retry of identical details.
        const fingerprint = JSON.stringify(item.payload);
        const storageKey =
          "kk-" + (isDev() ? "dev" : "prod") + "-payment-retry-" + keyOf(bill);

        let previous = null;

        try {
          previous = JSON.parse(
            sessionStorage.getItem(storageKey) || "null"
          );
        } catch {}

        const id = previous?.fingerprint === fingerprint
          ? previous.id
          : crypto.randomUUID();

        sessionStorage.setItem(storageKey, JSON.stringify({
          fingerprint,
          id
        }));

        const result = await receiptRequest("POST", {
          ...item.payload,
          idempotency_key: id
        });

        if (
          !result ||
          result.bill_no !== bill.bill_no ||
          result.branch !== bill.branch ||
          !Array.isArray(result.history) ||
          !Number.isFinite(Number(result.paid_amount)) ||
          !Number.isFinite(Number(result.balance))
        ) {
          throw new Error("Receipt confirmation mismatch");
        }

        sessionStorage.removeItem(storageKey);
        drafts.delete(keyOf(bill));
        saved++;

      } catch (error) {
        saveStatus(
          `${saved} bill(s) confirmed. ${bill.bill_no} needs review: ` +
          `${error.message}. Check View Saved Receipts before retrying.`
        );
        render();
        saveButton.disabled = false;
        return;
      }
    }

    render();
    saveButton.disabled = false;
    el("status").textContent =
      `${saved} ${isDev() ? "DEV TEST" : "PRODUCTION"} bill(s) saved successfully. ` +
      "Use View Saved Receipts to verify.";
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
          : split.method === "Take By Hand" ? ["Take By Hand"] : allAccounts();
      }

      function redrawBank() {
        bankCell.replaceChildren(
          createSelect(bankOptions(), split.bank, v => {
            split.bank = v;
          })
        );
      }

      const method = createSelect(
        ["UPI Store", "UPI Online", "Card", "Cash", ...(isProd() ? ["Take By Hand"] : [])],
        split.method,
        v => {
          split.method = v;
          split.bank = v === "Cash" ? "Cash" : v === "Take By Hand" ? "Take By Hand" : "";
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

      const historyButton = document.createElement("button");
      historyButton.type = "button";
      historyButton.textContent = "View Saved Receipts";

      const historyPanel = document.createElement("div");
      historyPanel.className = "small";
      historyPanel.style.marginTop = "8px";

      historyButton.onclick = () =>
        viewHistory(bill, historyPanel);

      ledgerCell.append(historyButton, historyPanel);

      const warning = document.createElement("div");
      warning.className = "small opening-status";
      warning.textContent = "Opening balance: verify before saving";
      ledgerCell.append(warning);

      if (canPreparePayments() && (!isDev() || /^TEST-[A-Za-z0-9_-]+$/.test(bill.bill_no))) {
        const approve = document.createElement("button");
        approve.type = "button";
        approve.className = "opening-approval-button";
        approve.textContent = isDev() ? "Approve Opening (DEV)" : "Approve Opening";
        approve.onclick = async () => {
          if (isProd()) {
            const ledger = await viewHistory(bill, historyPanel);
            if (!ledger || ledger.opening_approved === true) return;
          }
          await approveOpening(bill, historyPanel);
        };
        ledgerCell.append(approve);
        if (isDev()) viewHistory(bill, historyPanel);
      }

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
      saveStatus(error.message);
      alert(error.message);
    } finally {
      button.disabled = false;
    }
  };
  el("save-all").onclick = saveAllDev;

  el("find").onclick = async () => {
    page = 1;
    try {
      await load();
    } catch (error) {
      saveStatus(error.message);
    }
  };

  el("next").onclick = async () => {
    page++;
    try {
      await load();
    } catch (error) {
      page--;
      saveStatus(error.message);
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

    const saveButton = el("save-all");

    if (isDev()) {
      saveButton.disabled = false;
      saveButton.textContent = "Save All (DEV TEST)";
      saveButton.title = "Saves TEST invoices only";
      el("status").textContent +=
        " DEV TEST-only Save All enabled.";
    } else if (isProd()) {
      saveButton.disabled = false;
      saveButton.textContent = "Save All (PRODUCTION)";
      saveButton.title = "Server and database release gates must both be active";
      el("add-bank").disabled = true;
    } else {
      saveButton.disabled = true;
      saveButton.title = "Unverified environment";
    }
  } catch (error) {
    saveStatus(error.message);
  }
})();
let supabaseClient = null;
let currentUser = null;
let currentAgent = null;
let visitorSessionPromise = null;
let editingDossierId = null;
let dossierEditMode = false;
let dossierCache = [];
let showArchivedDossiers = false;
let agentNotificationsChannel = null;

const DOSSIER_STATUSES = [
  "Classified",
  "Fini de traitement",
  "En cours de traitement",
  "En attente de traitement"
];

const MAINTENANCE_PAGES = [
  ["index.html", "Informations"],
  ["dashboard.html", "Dashboard"],
  ["contact.html", "Contact et messagerie visiteur"],
  ["connexion.html", "Connexion"],
  ["messages.html", "Messages agents"],
  ["agents.html", "Comptes agents"],
  ["journal.html", "Journal"],
  ["status.html", "État du site"],
  ["maintenance.html", "Maintenance"]
];

function getSupabase() {
  if (supabaseClient) return supabaseClient;
  if (!window.supabase || !AR_CONFIG.supabaseUrl || !AR_CONFIG.supabaseAnonKey) {
    throw new Error("Supabase n’est pas configuré. Ajoutez l’URL du projet et la clé publique dans config.js.");
  }
  const projectRef = new URL(AR_CONFIG.supabaseUrl).hostname.split(".")[0];
  supabaseClient = window.supabase.createClient(AR_CONFIG.supabaseUrl, AR_CONFIG.supabaseAnonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
      storageKey: `sb-${projectRef}-auth-token`
    }
  });
  return supabaseClient;
}

function setFeedback(elementId, message, isError = true) {
  const element = document.getElementById(elementId);
  if (!element) return;
  element.textContent = message;
  element.classList.toggle("success", !isError);
}

function friendlyError(error) {
  if (!error) return "Une erreur inattendue est survenue.";
  if (error.code === "23505") return "Cette adresse e-mail est déjà utilisée.";
  if (error.code === "42501" || error.status === 403) return "Supabase a refusé cette action. Si votre compte est niveau 5, exécutez la dernière version de supabase/enhancements.sql et vérifiez que le compte est actif.";
  if (error.code === "PGRST116") return "Aucun résultat trouvé.";
  return error.message || "Une erreur inattendue est survenue.";
}

async function loadCurrentAgent() {
  const client = getSupabase();
  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  if (sessionError) throw sessionError;
  currentUser = sessionData.session?.user ?? null;
  currentAgent = null;

  if (currentUser) {
    if (currentUser.is_anonymous) {
      updateSessionControls();
      return null;
    }
    const { data, error } = await client
      .from("agent_profiles")
      .select("id, email, full_name, access_level, is_active, is_super_admin")
      .eq("id", currentUser.id)
      .single();
    if (error) throw error;
    if (!data.is_active) {
      await client.auth.signOut();
      currentUser = null;
      throw new Error("Ce compte agent est désactivé. Contactez un administrateur.");
    }
    currentAgent = data;
  }

  updateSessionControls();
  return currentAgent;
}

function updateSessionControls() {
  const active = Boolean(currentUser && currentAgent?.is_active);
  const loginLink = document.getElementById("login-link");
  const logoutButton = document.getElementById("logout-button");
  const userBadge = document.getElementById("user-badge");
  if (loginLink) loginLink.hidden = active;
  if (logoutButton) logoutButton.hidden = !active;
  if (userBadge) {
    userBadge.hidden = !active;
    if (active) {
      const text = currentAgent.full_name || currentAgent.email || "Agent";
      userBadge.innerHTML = '<span class="status-dot"></span>';
      userBadge.append(document.createTextNode(` ${text} · NIVEAU ${currentAgent.access_level}`));
    }
  }
  document.querySelectorAll("[data-agent-link]").forEach(link => {
    link.hidden = !active || (
      link.dataset.agentLink === "agents" &&
      currentAgent.access_level < 5 &&
      !currentAgent.is_super_admin
    );
  });
  document.querySelectorAll("[data-audit-link]").forEach(link => {
    link.hidden = !active || currentAgent.access_level < 4;
  });
  document.querySelectorAll("[data-message-link]").forEach(link => {
    link.hidden = !active;
  });
  document.querySelectorAll("[data-maintenance-link]").forEach(link => {
    link.hidden = !active || !currentAgent.is_super_admin;
  });
}

function currentPageKey() {
  return window.location.pathname.split("/").filter(Boolean).pop() || "index.html";
}

function renderMaintenanceScreen(message) {
  const wrapper = document.createElement("main");
  wrapper.style.cssText = "min-height:100vh;display:grid;place-content:center;padding:2rem;background:#0a0d14;color:#f8fafc;font-family:Inter,Arial,sans-serif;text-align:center";
  const title = document.createElement("p");
  title.style.cssText = "margin:0 0 .75rem;color:#00f0ff;font:700 .8rem 'JetBrains Mono',monospace;letter-spacing:.1em;text-transform:uppercase";
  title.textContent = "Maintenance";
  const heading = document.createElement("h1");
  heading.style.cssText = "margin:0 0 1rem;font-size:clamp(1.7rem,5vw,2.5rem)";
  heading.textContent = "Cette page est temporairement indisponible";
  const description = document.createElement("p");
  description.style.cssText = "max-width:36rem;margin:0 auto 1.5rem;color:#94a3b8;line-height:1.7";
  description.textContent = message;
  const contact = document.createElement("a");
  contact.href = "connexion.html";
  contact.textContent = "Accès administrateur";
  contact.style.cssText = "justify-self:center;color:#00f0ff";
  wrapper.append(title, heading, description, contact);
  document.body.replaceChildren(wrapper);
}

function showMaintenanceCheckWarning(error) {
  const warning = document.createElement("p");
  warning.setAttribute("role", "status");
  warning.style.cssText = "position:fixed;z-index:1000;right:1rem;bottom:1rem;max-width:28rem;margin:0;padding:.75rem 1rem;color:#111827;background:#fbbf24;border-radius:6px;font: .8rem/1.5 Inter,Arial,sans-serif;box-shadow:0 4px 20px #0008";
  warning.textContent = `État de maintenance non vérifié : ${friendlyError(error)}. Le site reste accessible.`;
  document.body.appendChild(warning);
}

async function enforceMaintenance() {
  if (currentAgent?.is_super_admin) return false;

  const { data, error } = await getSupabase().rpc("get_site_maintenance");
  if (error) throw error;
  const pageKey = currentPageKey();
  const pageStatus = data?.pages?.[pageKey];
  const activeMaintenance = data?.global?.enabled && pageKey !== "connexion.html"
    ? data.global
    : pageStatus?.enabled ? pageStatus : null;

  if (!activeMaintenance) return false;
  renderMaintenanceScreen(
    activeMaintenance.message || "Le site est temporairement en maintenance. Merci de revenir plus tard."
  );
  return true;
}

function renderMaintenanceControls(settings) {
  const container = document.getElementById("maintenance-controls");
  container.replaceChildren();

  const controls = [
    ["*", "Tout le site", settings.global],
    ...MAINTENANCE_PAGES.map(([key, label]) => [key, label, settings.pages?.[key]])
  ];

  for (const [pageKey, label, state] of controls) {
    const row = document.createElement("div");
    row.className = "maintenance-row";
    const caption = document.createElement("div");
    const title = document.createElement("label");
    const checkbox = document.createElement("input");
    const checkboxId = `maintenance-${pageKey === "*" ? "all" : pageKey.replace(".html", "")}`;
    checkbox.type = "checkbox";
    checkbox.id = checkboxId;
    checkbox.setAttribute("aria-label", `Activer la maintenance : ${label}`);
    checkbox.checked = Boolean(state?.enabled);
    let savedEnabled = checkbox.checked;
    title.htmlFor = checkboxId;
    title.textContent = label;
    const controls = document.createElement("div");
    controls.className = "maintenance-row-controls";
    const reason = document.createElement("textarea");
    reason.className = "maintenance-reason";
    reason.maxLength = 300;
    reason.rows = 2;
    reason.value = state?.message || "Le site est temporairement en maintenance. Merci de revenir plus tard.";
    reason.setAttribute("aria-label", `Raison affichée pour ${label}`);
    const save = document.createElement("button");
    save.type = "button";
    save.className = "btn-primary";
    save.textContent = "Enregistrer";
    caption.appendChild(title);
    if (pageKey === "*") {
      const hint = document.createElement("small");
      hint.textContent = "Bloque toutes les pages publiques, sauf l’accès du superadmin.";
      caption.appendChild(hint);
    }
    const persist = async () => {
      checkbox.disabled = true;
      reason.disabled = true;
      save.disabled = true;
      setFeedback("maintenance-feedback", "");
      try {
        const { error } = await getSupabase().rpc("set_site_maintenance", {
          p_page_key: pageKey,
          p_enabled: checkbox.checked,
          p_message: reason.value.trim()
        });
        if (error) throw error;
        savedEnabled = checkbox.checked;
        setFeedback("maintenance-feedback", `${label} : maintenance ${checkbox.checked ? "activée" : "désactivée"}.`, false);
      } catch (error) {
        checkbox.checked = savedEnabled;
        setFeedback("maintenance-feedback", friendlyError(error));
      } finally {
        checkbox.disabled = false;
        reason.disabled = false;
        save.disabled = false;
      }
    };
    checkbox.addEventListener("change", persist);
    save.addEventListener("click", persist);
    controls.append(checkbox, save);
    caption.appendChild(reason);
    row.append(caption, controls);
    container.appendChild(row);
  }
}

async function initializeMaintenancePage() {
  const agent = await loadCurrentAgent();
  if (!agent?.is_super_admin) {
    window.location.replace("index.html");
    return;
  }
  try {
    const { data, error } = await getSupabase().rpc("get_site_maintenance");
    if (error) throw error;
    renderMaintenanceControls(data ?? { global: { enabled: false }, pages: {} });
  } catch (error) {
    setFeedback("maintenance-feedback", `Impossible de charger les réglages : ${friendlyError(error)} Vérifiez que supabase/maintenance.sql a été exécuté.`);
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const client = getSupabase();
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  setFeedback("login-feedback", "");

  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    setFeedback("login-feedback", friendlyError(error));
    return;
  }

  currentUser = data.user;
  try {
    await loadCurrentAgent();
    const { error: logError } = await getSupabase().rpc("log_agent_activity", { p_action: "login" });
    if (logError) throw logError;
    window.location.replace("dashboard.html");
  } catch (profileError) {
    await client.auth.signOut();
    currentUser = null;
    currentAgent = null;
    updateSessionControls();
    setFeedback("login-feedback", friendlyError(profileError));
  }
}

async function logout() {
  try {
    const client = getSupabase();
    let auditError = null;
    if (currentAgent) {
      const { error: logError } = await client.rpc("log_agent_activity", { p_action: "logout" });
      auditError = logError;
    }
    const { error } = await client.auth.signOut();
    if (error) throw error;
    currentUser = null;
    currentAgent = null;
    if (auditError) {
      console.error("La déconnexion a réussi, mais le journal n’a pas été mis à jour :", auditError);
      alert(`Déconnecté, mais l’action n’a pas pu être ajoutée au journal : ${friendlyError(auditError)}`);
    }
    window.location.href = "index.html";
  } catch (error) {
    console.error("Erreur lors de la déconnexion :", error);
    alert(`Déconnexion impossible : ${friendlyError(error)}`);
  }
}

function createCell(text, className = "") {
  const cell = document.createElement("td");
  cell.textContent = text == null ? "" : String(text);
  if (className) cell.className = className;
  return cell;
}

function updateDashboardStats(rows) {
  const totalLabel = document.querySelector("#stat-total").previousElementSibling;
  totalLabel.textContent = showArchivedDossiers ? "Dossiers archivés" : "Dossiers actifs";
  document.getElementById("stat-total").textContent = String(rows.length);
  document.getElementById("stat-waiting").textContent = String(rows.filter(row => row.statut === "En attente de traitement").length);
  document.getElementById("stat-progress").textContent = String(rows.filter(row => row.statut === "En cours de traitement").length);
  document.getElementById("stat-finished").textContent = String(rows.filter(row => row.statut === "Fini de traitement").length);
  document.getElementById("stat-classified").textContent = String(rows.filter(row => row.statut === "Classified").length);
}

async function fetchDossiers() {
  let query = getSupabase()
    .from("dossiers")
    .select("id, code, sujet, niveau, statut, created_at, archived_at")
    .order("id", { ascending: false });
  query = showArchivedDossiers
    ? query.not("archived_at", "is", null)
    : query.is("archived_at", null);
  const { data, error } = await query;
  if (error) throw error;

  const rows = data ?? [];
  dossierCache = rows;
  updateDashboardStats(rows);
  renderDossiers();
}

function renderDossiers() {
  const search = document.getElementById("dossier-search")?.value.trim().toLocaleLowerCase("fr") ?? "";
  const level = document.getElementById("filter-level")?.value ?? "";
  const status = document.getElementById("filter-status")?.value ?? "";
  const rows = dossierCache.filter(dossier =>
    (!search || dossier.code.toLocaleLowerCase("fr").includes(search) || dossier.sujet.toLocaleLowerCase("fr").includes(search)) &&
    (!level || String(dossier.niveau) === level) &&
    (!status || dossier.statut === status)
  );
  const tbody = document.getElementById("dossiers-table-body");
  tbody.replaceChildren();

  if (!rows.length) {
    const emptyRow = document.createElement("tr");
    const emptyCell = createCell(dossierCache.length
      ? "Aucun dossier ne correspond à ces filtres."
      : currentUser
        ? "Aucun dossier accessible à votre niveau."
        : "Aucun dossier public pour le moment.");
    emptyCell.colSpan = dossierEditMode || currentAgent?.access_level >= 4 ? 5 : 4;
    emptyCell.className = "empty-state";
    emptyRow.appendChild(emptyCell);
    tbody.appendChild(emptyRow);
    return;
  }

  for (const dossier of rows) {
    const row = document.createElement("tr");
    row.classList.add(dossier.statut === "Classified" ? "priority-classified"
      : dossier.statut === "En attente de traitement" ? "priority-waiting"
        : dossier.statut === "En cours de traitement" ? "priority-progress" : "priority-finished");
    row.appendChild(createCell(dossier.code, "code-text"));
    row.appendChild(createCell(dossier.sujet));
    const levelCell = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = `Niveau ${dossier.niveau}`;
    levelCell.appendChild(badge);
    row.appendChild(levelCell);
    const statusCell = createCell(dossier.statut, `status-cell status-${DOSSIER_STATUSES.indexOf(dossier.statut)}`);
    row.appendChild(statusCell);

    if (dossierEditMode || (currentAgent && currentAgent.access_level >= 4)) {
      const actions = document.createElement("td");
      if (dossierEditMode) {
        const edit = document.createElement("button");
        edit.className = "btn-edit";
        edit.type = "button";
        edit.setAttribute("aria-label", `Modifier le dossier ${dossier.code}`);
        edit.innerHTML = '<i class="fa-solid fa-pen" aria-hidden="true"></i>';
        edit.addEventListener("click", () => openDossierModal(dossier));
        actions.appendChild(edit);
        if (currentAgent && currentAgent.access_level >= 4) {
          const archive = document.createElement("button");
          archive.className = "btn-archive";
          archive.type = "button";
          archive.setAttribute("aria-label", `${showArchivedDossiers ? "Restaurer" : "Archiver"} le dossier ${dossier.code}`);
          archive.title = showArchivedDossiers ? "Restaurer" : "Archiver";
          archive.innerHTML = `<i class="fa-solid ${showArchivedDossiers ? "fa-box-open" : "fa-box-archive"}" aria-hidden="true"></i>`;
          archive.addEventListener("click", () => archiveDossier(dossier, !showArchivedDossiers));
          actions.appendChild(archive);
        }
      }
      if (currentAgent && currentAgent.access_level >= 4) {
        const history = document.createElement("button");
        history.className = "btn-edit";
        history.type = "button";
        history.setAttribute("aria-label", `Afficher l’historique du dossier ${dossier.code}`);
        history.innerHTML = '<i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i>';
        history.addEventListener("click", () => openDossierHistory(dossier));
        actions.appendChild(history);
      }
      row.appendChild(actions);
    }
    tbody.appendChild(row);
  }
}

function setDossierFormMode(dossier = null) {
  editingDossierId = dossier?.id ?? null;
  const code = document.getElementById("form-code");
  const title = document.getElementById("modal-title");
  const level = document.getElementById("form-niveau");
  const status = document.getElementById("form-statut");
  title.textContent = dossier ? `Modifier ${dossier.code}` : "Créer un dossier";
  code.value = dossier?.code ?? "Attribué automatiquement";
  code.disabled = true;
  document.getElementById("form-sujet").value = dossier?.sujet ?? "";
  level.value = dossier ? `Niveau ${dossier.niveau}` : `Niveau ${currentAgent?.access_level ?? 1}`;
  Array.from(level.options).forEach(option => {
    const optionLevel = Number(option.value.replace("Niveau ", ""));
    option.disabled = !dossier && optionLevel > (currentAgent?.access_level ?? 1);
  });
  status.value = dossier?.statut ?? "En attente de traitement";
  level.disabled = false;
  if (status.value === "Classified") {
    level.value = "Niveau 5";
    level.disabled = true;
  }
}

function openDossierModal(dossier = null) {
  setDossierFormMode(dossier);
  document.getElementById("add-modal").classList.add("open");
  document.getElementById("form-sujet").focus();
}

function closeDossierModal() {
  document.getElementById("add-modal").classList.remove("open");
  document.getElementById("dossier-form").reset();
  editingDossierId = null;
}

async function handleDossierSubmit(event) {
  event.preventDefault();
  const client = getSupabase();
  const status = document.getElementById("form-statut").value;
  if (!DOSSIER_STATUSES.includes(status)) {
    setFeedback("dossier-feedback", "Sélectionnez un statut autorisé.");
    return;
  }
  const values = {
    sujet: document.getElementById("form-sujet").value.trim(),
    niveau: status === "Classified"
      ? 5
      : Number(document.getElementById("form-niveau").value.replace("Niveau ", "")),
    statut: status
  };

  const query = editingDossierId
    ? client.from("dossiers").update(values).eq("id", editingDossierId).select("id")
    : client.from("dossiers").insert(values).select("id");
  const { data, error } = await query;
  if (error) {
    setFeedback("dossier-feedback", friendlyError(error));
    return;
  }
  if (!data?.length) {
    setFeedback("dossier-feedback", "Aucun dossier modifié : vérifiez votre niveau d’accès.");
    return;
  }

  closeDossierModal();
  setFeedback("dashboard-feedback", "Dossier enregistré.", false);
  await fetchDossiers();
}

async function archiveDossier(dossier, archive) {
  const action = archive ? "archiver" : "restaurer";
  if (!confirm(`Confirmer la ${action} du dossier ${dossier.code} ?`)) return;
  const { data, error } = await getSupabase()
    .from("dossiers")
    .update({ archived_at: archive ? new Date().toISOString() : null, archived_by: archive ? currentUser.id : null })
    .eq("id", dossier.id)
    .select("id");
  if (error) {
    setFeedback("dashboard-feedback", friendlyError(error));
    return;
  }
  if (!data?.length) {
    setFeedback("dashboard-feedback", "Dossier non modifié : votre niveau d’accès est insuffisant.");
    return;
  }
  setFeedback("dashboard-feedback", `Dossier ${dossier.code} ${archive ? "archivé" : "restauré"}.`, false);
  await fetchDossiers();
}

async function openDossierHistory(dossier) {
  const modal = document.getElementById("history-modal");
  const list = document.getElementById("dossier-history");
  document.getElementById("history-title").textContent = `Historique — ${dossier.code}`;
  list.replaceChildren();
  modal.hidden = false;
  modal.classList.add("open");
  setFeedback("history-feedback", "");
  try {
    const { data, error } = await getSupabase()
      .from("activity_logs")
      .select("actor_email, action, details, created_at")
      .eq("target_type", "dossier")
      .eq("target_id", String(dossier.id))
      .order("created_at", { ascending: false });
    if (error) throw error;
    if (!data?.length) {
      const empty = document.createElement("li");
      empty.textContent = "Aucun changement enregistré.";
      list.appendChild(empty);
      return;
    }
    data.forEach(entry => {
      const item = document.createElement("li");
      const heading = document.createElement("strong");
      heading.textContent = `${entry.actor_email} · ${new Date(entry.created_at).toLocaleString("fr-FR")}`;
      const action = document.createElement("span");
      action.textContent = entry.action.replaceAll("_", " ");
      const details = document.createElement("pre");
      details.textContent = JSON.stringify(entry.details, null, 2);
      item.append(heading, action, details);
      list.appendChild(item);
    });
    setFeedback("history-feedback", "");
  } catch (error) {
    setFeedback("history-feedback", friendlyError(error));
  }
}

function exportDossiersCsv() {
  if (!currentAgent || currentAgent.access_level < 4) return;
  const records = dossierCache;
  const fields = ["code", "sujet", "niveau", "statut", "created_at"];
  const csvCell = value => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const csv = [fields.join(";"), ...records.map(row => fields.map(field => csvCell(field === "niveau" ? `Niveau ${row[field]}` : row[field])).join(";"))].join("\r\n");
  const url = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `dossiers-site11-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportDossiersPdf() {
  if (!currentAgent || currentAgent.access_level < 4) return;
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    setFeedback("dashboard-feedback", "Autorisez les fenêtres pop-up pour préparer l’export PDF.");
    return;
  }
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
  const tableRows = dossierCache.map(row =>
    `<tr><td>${escapeHtml(row.code)}</td><td>${escapeHtml(row.sujet)}</td><td>Niveau ${escapeHtml(row.niveau)}</td><td>${escapeHtml(row.statut)}</td></tr>`
  ).join("");
  printWindow.document.write(`<!doctype html><html lang="fr"><meta charset="utf-8"><title>Export des dossiers Site 11</title><style>body{font:14px Arial,sans-serif;margin:24px;color:#111}h1{font-size:20px}table{width:100%;border-collapse:collapse}th,td{padding:8px;border:1px solid #bbb;text-align:left}th{background:#eee}@media print{body{margin:0}}</style><h1>Export des dossiers — Site 11</h1><p>Exporté le ${escapeHtml(new Date().toLocaleString("fr-FR"))} · Niveau ${currentAgent.access_level}</p><table><thead><tr><th>Code</th><th>Sujet</th><th>Niveau</th><th>Statut</th></tr></thead><tbody>${tableRows}</tbody></table><script>window.onload=()=>window.print()</script></html>`);
  printWindow.document.close();
  setFeedback("dashboard-feedback", "Dans la fenêtre d’impression, choisissez « Enregistrer au format PDF ».", false);
}

function setDossierEditMode(enabled) {
  dossierEditMode = enabled;
  const toggle = document.getElementById("toggle-dossier-edit");
  if (toggle) {
    toggle.innerHTML = enabled
      ? '<i class="fa-solid fa-check" aria-hidden="true"></i> Terminer'
      : '<i class="fa-solid fa-pen" aria-hidden="true"></i> Modifier les dossiers';
    toggle.setAttribute("aria-pressed", String(enabled));
  }
  const addButton = document.getElementById("open-modal");
  if (addButton) addButton.hidden = !enabled;
  const actionsHeading = document.getElementById("table-actions-heading");
  if (actionsHeading) actionsHeading.hidden = !enabled && !(currentAgent?.access_level >= 4);
  renderDossiers();
}

function formatChatTime(value) {
  return new Date(value).toLocaleString("fr-FR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"
  });
}

function statusLabel(status) {
  return ({
    waiting: "En attente",
    in_progress: "En cours",
    treated: "Traité"
  })[status] ?? status;
}

async function ensureVisitorSession(createIfMissing = true) {
  const client = getSupabase();
  const getOrCreateSession = async () => {
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    if (data.session?.user?.is_anonymous) {
      currentUser = data.session.user;
      return currentUser;
    }
    if (data.session?.user && !data.session.user.is_anonymous) {
      await loadCurrentAgent();
      if (currentAgent) throw new Error("La messagerie visiteur est disponible hors connexion. Consultez la page Messages pour répondre aux visiteurs.");
      await client.auth.signOut();
    }
    if (!createIfMissing) {
      currentUser = null;
      return null;
    }
    const { data: anonymousData, error: anonymousError } = await client.auth.signInAnonymously();
    if (anonymousError) {
      throw new Error("La messagerie visiteur n’est pas activée. Activez Anonymous Sign-Ins dans Supabase Authentication > Sign In / Providers.");
    }
    currentUser = anonymousData.user;
    currentAgent = null;
    return currentUser;
  };

  const projectRef = new URL(AR_CONFIG.supabaseUrl).hostname.split(".")[0];
  if (navigator.locks?.request) {
    return navigator.locks.request(`site11-visitor-session-${projectRef}`, getOrCreateSession);
  }
  if (visitorSessionPromise) return visitorSessionPromise;
  visitorSessionPromise = getOrCreateSession().finally(() => {
    visitorSessionPromise = null;
  });
  return visitorSessionPromise;
}

async function renderChatMessageList(container, messages, agentView) {
  container.replaceChildren();
  if (!messages.length) {
    const empty = document.createElement("p");
    empty.className = "chat-empty";
    empty.textContent = "Aucun message pour le moment.";
    container.appendChild(empty);
    return;
  }

  for (const message of messages) {
    const item = document.createElement("article");
    item.className = `chat-message ${message.sender_role === "agent" ? "from-agent" : "from-visitor"}`;
    const label = document.createElement("span");
    label.className = "chat-message-sender";
    label.textContent = message.sender_role === "agent" ? "Équipe" : (agentView ? "Visiteur" : "Vous");
    const body = document.createElement("p");
    body.textContent = message.body;
    const time = document.createElement("time");
    time.dateTime = message.created_at;
    time.textContent = formatChatTime(message.created_at);
    item.append(label, body, time);
    if (message.attachment_path) {
      const { data, error } = await getSupabase().storage.from("chat-attachments")
        .createSignedUrl(message.attachment_path, 900);
      if (error) throw error;
      const attachment = document.createElement("a");
      attachment.className = "chat-attachment";
      attachment.href = data.signedUrl;
      attachment.target = "_blank";
      attachment.rel = "noopener noreferrer";
      const icon = document.createElement("i");
      icon.className = "fa-solid fa-paperclip";
      icon.setAttribute("aria-hidden", "true");
      attachment.append(icon, document.createTextNode(` ${message.attachment_name} (${(message.attachment_size / 1024 / 1024).toFixed(1)} Mo)`));
      item.appendChild(attachment);
    }
    container.appendChild(item);
  }
  container.scrollTop = container.scrollHeight;
}

async function fetchVisitorConversations() {
  const { data, error } = await getSupabase()
    .from("chat_conversations")
    .select("id, visitor_name, status, created_at, updated_at")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

async function fetchConversationMessages(conversationId) {
  const { data, error } = await getSupabase()
    .from("chat_messages")
    .select("id, sender_id, sender_role, body, created_at, attachment_path, attachment_name, attachment_type, attachment_size")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

async function sendChatAttachment(conversationId, file, body, senderRole) {
  const allowedTypes = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
  if (!allowedTypes.includes(file.type)) {
    throw new Error("Formats autorisés : JPG, PNG, WebP et PDF.");
  }
  if (file.size < 1 || file.size > 10 * 1024 * 1024) {
    throw new Error("Chaque pièce jointe doit peser au maximum 10 Mo.");
  }
  const extension = ({
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "application/pdf": "pdf"
  })[file.type];
  const path = `${conversationId}/${crypto.randomUUID()}.${extension}`;
  const storage = getSupabase().storage.from("chat-attachments");
  const { error: uploadError } = await storage.upload(path, file, {
    contentType: file.type,
    upsert: false
  });
  if (uploadError) throw uploadError;
  const { error: messageError } = await getSupabase().from("chat_messages").insert({
    conversation_id: conversationId,
    sender_id: currentUser.id,
    sender_role: senderRole,
    body: body || `Pièce jointe : ${file.name}`,
    attachment_path: path,
    attachment_name: file.name,
    attachment_type: file.type,
    attachment_size: file.size
  });
  if (messageError) {
    const { error: removeError } = await storage.remove([path]);
    if (removeError) console.error("Pièce jointe envoyée mais non associée à un message :", removeError);
    throw messageError;
  }
}

async function startVisitorConversation(name, body) {
  await ensureVisitorSession();
  const { data, error } = await getSupabase().rpc("create_visitor_conversation", {
    p_visitor_name: name,
    p_initial_message: body
  });
  if (error) throw error;
  return data;
}

async function fetchAgentConversations() {
  const { data, error } = await getSupabase()
    .from("chat_conversations")
    .select("id, visitor_name, status, created_at, updated_at")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

async function initializeMessagesPage() {
  const agent = await loadCurrentAgent();
  if (!agent) {
    window.location.replace("connexion.html");
    return;
  }
  configureAttachmentPicker("messages-reply-file");

  const list = document.getElementById("messages-conversation-list");
  const thread = document.getElementById("messages-thread");
  const feedback = message => setFeedback("messages-feedback", message);
  let conversations = [];
  let selectedId = null;

  const renderList = () => {
    list.replaceChildren();
    if (!conversations.length) {
      const empty = document.createElement("p");
      empty.className = "chat-empty";
      empty.textContent = "Aucune conversation à afficher.";
      list.appendChild(empty);
      return;
    }
    for (const conversation of conversations) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `inbox-conversation${conversation.id === selectedId ? " selected" : ""}`;
      const title = document.createElement("strong");
      title.textContent = conversation.visitor_name;
      const date = document.createElement("small");
      date.textContent = formatChatTime(conversation.updated_at);
      const status = document.createElement("span");
      status.className = `chat-status status-${conversation.status}`;
      status.textContent = statusLabel(conversation.status);
      button.append(title, date, status);
      button.addEventListener("click", () => selectConversation(conversation.id));
      list.appendChild(button);
    }
  };

  const selectConversation = async id => {
    selectedId = id;
    const conversation = conversations.find(item => item.id === id);
    if (!conversation) return;
    document.getElementById("messages-detail").hidden = false;
    document.getElementById("messages-empty").hidden = true;
    document.getElementById("messages-current-name").textContent = conversation.visitor_name;
    const statusSelect = document.getElementById("messages-status");
    statusSelect.value = conversation.status;
    const deleteButton = document.getElementById("messages-delete");
    deleteButton.hidden = agent.access_level < 5;
    renderList();
    try {
      await renderChatMessageList(thread, await fetchConversationMessages(id), true);
      feedback("");
    } catch (error) {
      feedback(friendlyError(error));
    }
  };

  const refresh = async () => {
    try {
      conversations = await fetchAgentConversations();
      renderList();
      if (selectedId) await selectConversation(selectedId);
      feedback("");
    } catch (error) {
      feedback(friendlyError(error));
    }
  };

  document.getElementById("messages-reply-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (!selectedId) return;
    const input = document.getElementById("messages-reply");
    const body = input.value.trim();
    const fileInput = document.getElementById("messages-reply-file");
    const file = fileInput.files[0];
    if (!body && !file) return;
    try {
      if (file) await sendChatAttachment(selectedId, file, body, "agent");
      else {
        const { error } = await getSupabase().from("chat_messages").insert({
          conversation_id: selectedId,
          sender_id: currentUser.id,
          sender_role: "agent",
          body
        });
        if (error) throw error;
      }
      input.value = "";
      fileInput.value = "";
      await refresh();
    } catch (error) {
      feedback(friendlyError(error));
    }
  });

  document.getElementById("messages-status").addEventListener("change", async event => {
    if (!selectedId) return;
    try {
      const { error } = await getSupabase().from("chat_conversations")
        .update({ status: event.currentTarget.value }).eq("id", selectedId);
      if (error) throw error;
      await refresh();
    } catch (error) {
      feedback(friendlyError(error));
      await refresh();
    }
  });

  document.getElementById("messages-delete").addEventListener("click", async () => {
    const conversation = conversations.find(item => item.id === selectedId);
    if (!conversation || agent.access_level < 5) return;
    if (!confirm(`Supprimer la conversation de ${conversation.visitor_name} et tous ses messages ?`)) return;
    try {
      const { error } = await getSupabase().from("chat_conversations").delete().eq("id", selectedId);
      if (error) throw error;
      selectedId = null;
      document.getElementById("messages-detail").hidden = true;
      document.getElementById("messages-empty").hidden = false;
      await refresh();
    } catch (error) {
      feedback(friendlyError(error));
    }
  });

  await refresh();
  window.setInterval(refresh, 10000);
}

async function initializeContactForm() {
  const form = document.getElementById("contact-message-form");
  if (!form) return;
  if (currentAgent) {
    form.hidden = true;
    document.getElementById("open-contact-chat").hidden = true;
    setFeedback("contact-message-feedback", "Vous êtes connecté comme agent. Utilisez la page Messages pour répondre aux visiteurs.");
    return;
  }
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const submitButton = document.getElementById("contact-message-submit");
    submitButton.disabled = true;
    setFeedback("contact-message-feedback", "");
    try {
      const visitorName = document.getElementById("contact-visitor-name").value.trim();
      const message = document.getElementById("contact-message-body").value.trim();
      await startVisitorConversation(visitorName, message);
      form.reset();
      setFeedback("contact-message-feedback", "Message envoyé sans quitter cette page. Retrouvez la conversation dans la bulle Messagerie en bas à gauche.", false);
      const chatPanel = document.getElementById("chat-panel");
      if (chatPanel?.hidden) document.getElementById("chat-launcher")?.click();
    } catch (error) {
      console.error("Impossible d’envoyer le message du formulaire Contact :", error);
      setFeedback("contact-message-feedback", friendlyError(error));
    } finally {
      submitButton.disabled = false;
    }
  });
}

function showAgentNotification(title, body, targetPage) {
  const toast = document.createElement("div");
  toast.className = "agent-notification-toast";
  const heading = document.createElement("strong");
  heading.textContent = title;
  const message = document.createElement("span");
  message.textContent = body;
  toast.append(heading, message);
  toast.addEventListener("click", () => {
    window.location.href = targetPage;
  });
  document.body.appendChild(toast);
  window.setTimeout(() => toast.remove(), 8000);
  if ("Notification" in window && Notification.permission === "granted") {
    try {
      const notification = new Notification(title, { body, tag: `site11-${targetPage}` });
      notification.onclick = () => {
        window.focus();
        window.location.href = targetPage;
      };
    } catch (error) {
      console.warn("La notification système n’a pas pu être affichée :", error);
    }
  }
}

function configureAttachmentPicker(inputId) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const label = document.querySelector(`label[for="${inputId}"] span`);
  input.addEventListener("change", () => {
    const file = input.files[0];
    if (label) label.textContent = file ? file.name : "Joindre";
  });
}

async function initializeAgentNotifications() {
  if (!currentAgent) return;
  const actions = document.querySelector(".header-actions");
  if (!actions) return;
  const button = document.createElement("button");
  button.className = "notification-toggle";
  button.type = "button";
  button.setAttribute("aria-pressed", "false");
  button.innerHTML = '<i class="fa-regular fa-bell" aria-hidden="true"></i><span>Activer les alertes</span>';
  actions.insertBefore(button, actions.firstChild);
  const preferenceKey = `site11-agent-notifications-${currentUser.id}`;
  let enabled = false;
  try {
    enabled = localStorage.getItem(preferenceKey) === "true";
  } catch (error) {
    console.warn("La préférence des alertes ne peut pas être lue dans ce navigateur :", error);
    button.title = "Les alertes fonctionneront pour cette visite, mais votre choix ne pourra pas être mémorisé.";
  }

  const stopListening = () => {
    if (!agentNotificationsChannel) return;
    getSupabase().removeChannel(agentNotificationsChannel);
    agentNotificationsChannel = null;
  };
  const startListening = () => {
    if (agentNotificationsChannel) return;
    agentNotificationsChannel = getSupabase()
      .channel(`site11-agent-events-${currentUser.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "dossiers" }, payload => {
        const dossier = payload.new?.code ? payload.new : payload.old;
        const action = payload.eventType === "INSERT" ? "Nouveau dossier"
          : payload.eventType === "DELETE" ? "Dossier supprimé" : "Dossier modifié";
        showAgentNotification(action, dossier?.code || "Un dossier a changé.", "dashboard.html");
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, async payload => {
        if (payload.new?.sender_role !== "visitor") return;
        try {
          const { data, error } = await getSupabase().from("chat_conversations")
            .select("visitor_name").eq("id", payload.new.conversation_id).maybeSingle();
          if (error) throw error;
          showAgentNotification("Nouveau message visiteur", data?.visitor_name || "Une conversation a reçu un message.", "messages.html");
        } catch (error) {
          console.error("Impossible de récupérer l’origine du nouveau message :", error);
          showAgentNotification("Nouveau message visiteur", "Une conversation a reçu un message.", "messages.html");
        }
      })
      .subscribe((status, error) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.error("Écoute des notifications impossible :", error || status);
          button.title = "Connexion aux notifications impossible. Vérifiez la migration Realtime Supabase.";
        }
      });
  };
  const renderButton = () => {
    button.setAttribute("aria-pressed", String(enabled));
    button.innerHTML = enabled
      ? '<i class="fa-solid fa-bell" aria-hidden="true"></i><span>Alertes activées</span>'
      : '<i class="fa-regular fa-bell" aria-hidden="true"></i><span>Activer les alertes</span>';
  };
  renderButton();
  if (enabled) startListening();
  button.addEventListener("click", async () => {
    enabled = !enabled;
    if (enabled) {
      if ("Notification" in window && Notification.permission === "default") {
        try {
          await Notification.requestPermission();
        } catch (error) {
          console.warn("La permission de notification système n’a pas pu être demandée :", error);
        }
      }
      try {
        localStorage.setItem(preferenceKey, "true");
      } catch (error) {
        console.warn("La préférence des alertes ne peut pas être mémorisée :", error);
        button.title = "Les alertes fonctionneront pour cette visite uniquement.";
      }
      startListening();
    } else {
      try {
        localStorage.removeItem(preferenceKey);
      } catch (error) {
        console.warn("La préférence des alertes n’a pas pu être effacée :", error);
      }
      stopListening();
    }
    renderButton();
  });
}

function appendChatWidget() {
  const root = document.createElement("div");
  root.id = "site-chat";
  root.innerHTML = `
    <button class="chat-launcher" id="chat-launcher" type="button" aria-label="Ouvrir la messagerie" aria-expanded="false">
      <i class="fa-regular fa-comments" aria-hidden="true"></i><span>Messagerie</span>
    </button>
    <section class="chat-panel" id="chat-panel" role="dialog" aria-modal="false" aria-labelledby="chat-title" hidden>
      <header class="chat-panel-header"><div><span class="chat-eyebrow">Site 11</span><h2 id="chat-title">Messagerie</h2></div><button class="chat-close" id="chat-close" type="button" aria-label="Fermer la messagerie">×</button></header>
      <div class="chat-panel-content">
        <p class="chat-feedback" id="chat-feedback" role="status" aria-live="polite"></p>
        <div class="chat-list-view" id="chat-list-view">
          <button class="chat-new-button" id="chat-new-button" type="button"><i class="fa-solid fa-plus" aria-hidden="true"></i> Nouvelle conversation</button>
          <div class="chat-conversation-list" id="chat-conversation-list"></div>
          <p class="chat-privacy">Vos conversations sont conservées dans ce navigateur. Utilisez le même navigateur pour les retrouver.</p>
        </div>
        <div class="chat-detail-view" id="chat-detail-view" hidden>
          <button class="chat-back-button" id="chat-back-button" type="button"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i> Toutes les conversations</button>
          <div class="chat-current-heading"><span class="chat-status" id="chat-current-status"></span><strong id="chat-current-name"></strong></div>
          <div class="chat-thread" id="chat-thread" aria-live="polite"></div>
            <form class="chat-reply-form" id="chat-reply-form"><label class="visually-hidden" for="chat-reply-input">Votre message</label><textarea id="chat-reply-input" maxlength="4000" placeholder="Écrivez votre message…"></textarea><input class="chat-file-input" id="chat-reply-file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf"><label class="chat-file-label" for="chat-reply-file"><i class="fa-solid fa-paperclip" aria-hidden="true"></i><span>Joindre</span></label><button type="submit" aria-label="Envoyer le message"><i class="fa-solid fa-paper-plane" aria-hidden="true"></i></button></form>
        </div>
        <form class="chat-new-view" id="chat-new-form" hidden>
          <button class="chat-back-button" id="chat-new-back" type="button"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i> Toutes les conversations</button>
          <p class="chat-guidance">Après l’envoi, l’équipe pourra répondre dans cette conversation. Revenez avec le même navigateur pour lire sa réponse.</p>
          <label for="chat-visitor-name">Votre nom</label><input id="chat-visitor-name" maxlength="100" required autocomplete="name" placeholder="Nom ou pseudonyme">
          <label for="chat-first-message">Votre message</label><textarea id="chat-first-message" maxlength="4000" required placeholder="Comment pouvons-nous vous aider ?"></textarea>
          <input class="chat-file-input" id="chat-first-file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf"><label class="chat-file-label" for="chat-first-file"><i class="fa-solid fa-paperclip" aria-hidden="true"></i><span>Ajouter une pièce jointe (facultatif)</span></label>
          <small class="chat-file-help">JPG, PNG, WebP ou PDF · 10 Mo maximum</small>
          <button class="chat-send-first" type="submit"><i class="fa-solid fa-paper-plane" aria-hidden="true"></i> Envoyer</button>
        </form>
      </div>
    </section>`;
  document.body.appendChild(root);
}

async function initializeChatWidget() {
  if (currentAgent) return;
  appendChatWidget();
  const panel = document.getElementById("chat-panel");
  const launcher = document.getElementById("chat-launcher");
  const listView = document.getElementById("chat-list-view");
  const detailView = document.getElementById("chat-detail-view");
  const newView = document.getElementById("chat-new-form");
  const list = document.getElementById("chat-conversation-list");
  const thread = document.getElementById("chat-thread");
  configureAttachmentPicker("chat-first-file");
  configureAttachmentPicker("chat-reply-file");
  let selectedConversationId = null;
  let refreshTimer = null;

  const setChatError = error => {
    const feedback = document.getElementById("chat-feedback");
    feedback.textContent = error ? friendlyError(error) : "";
    feedback.classList.toggle("success", false);
  };
  const openList = async () => {
    selectedConversationId = null;
    listView.hidden = false;
    detailView.hidden = true;
    newView.hidden = true;
    try {
      const visitor = await ensureVisitorSession(false);
      setChatError(null);
      if (!visitor) {
        list.replaceChildren();
        const empty = document.createElement("p");
        empty.className = "chat-empty";
        empty.textContent = "Aucune conversation sur ce navigateur. Une session anonyme sera créée uniquement lors de l’envoi de votre premier message.";
        list.appendChild(empty);
        return;
      }
      const conversations = await fetchVisitorConversations();
      list.replaceChildren();
      if (!conversations.length) {
        const empty = document.createElement("p");
        empty.className = "chat-empty";
        empty.textContent = "Aucune conversation pour le moment. Écrivez-nous, nous vous répondrons ici.";
        list.appendChild(empty);
      }
      conversations.forEach(conversation => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "chat-conversation-item";
        const info = document.createElement("span");
        const name = document.createElement("strong");
        name.textContent = conversation.visitor_name;
        const date = document.createElement("small");
        date.textContent = formatChatTime(conversation.updated_at);
        info.append(name, date);
        const status = document.createElement("span");
        status.className = `chat-status status-${conversation.status}`;
        status.textContent = statusLabel(conversation.status);
        button.append(info, status);
        button.addEventListener("click", () => openVisitorConversation(conversation));
        list.appendChild(button);
      });
    } catch (error) {
      setChatError(error);
    }
  };

  const openVisitorConversation = async conversation => {
    selectedConversationId = conversation.id;
    listView.hidden = true;
    detailView.hidden = false;
    newView.hidden = true;
    document.getElementById("chat-current-name").textContent = conversation.visitor_name;
    const status = document.getElementById("chat-current-status");
    status.className = `chat-status status-${conversation.status}`;
    status.textContent = statusLabel(conversation.status);
    try {
      const messages = await fetchConversationMessages(conversation.id);
      await renderChatMessageList(thread, messages, false);
      setChatError(null);
    } catch (error) {
      setChatError(error);
    }
  };

  launcher.addEventListener("click", async () => {
    const opening = panel.hidden;
    panel.hidden = !opening;
    launcher.setAttribute("aria-expanded", String(opening));
    if (opening) await openList();
    else if (refreshTimer) {
      window.clearInterval(refreshTimer);
      refreshTimer = null;
    }
    if (opening && !refreshTimer) {
      refreshTimer = window.setInterval(async () => {
        if (panel.hidden) return;
        try {
          if (selectedConversationId) {
            const { data, error } = await getSupabase().from("chat_conversations")
              .select("id, visitor_name, status, updated_at").eq("id", selectedConversationId).maybeSingle();
            if (error) throw error;
            if (data) await openVisitorConversation(data);
            else await openList();
          } else if (listView.hidden === false) {
            await openList();
          }
        } catch (error) {
          setChatError(error);
        }
      }, 7000);
    }
  });
  document.getElementById("chat-close").addEventListener("click", () => {
    panel.hidden = true;
    launcher.setAttribute("aria-expanded", "false");
    if (refreshTimer) window.clearInterval(refreshTimer);
    refreshTimer = null;
  });
  document.getElementById("chat-new-button").addEventListener("click", () => {
    listView.hidden = true;
    detailView.hidden = true;
    newView.hidden = false;
    setChatError(null);
    document.getElementById("chat-visitor-name").focus();
  });
  document.getElementById("chat-new-back").addEventListener("click", openList);
  document.getElementById("chat-back-button").addEventListener("click", openList);
  document.getElementById("chat-new-form").addEventListener("submit", async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button[type=submit]");
    button.disabled = true;
    const file = document.getElementById("chat-first-file").files[0];
    try {
      if (file && (!["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(file.type) || file.size > 10 * 1024 * 1024)) {
        throw new Error("Choisissez une image JPG/PNG/WebP ou un PDF de 10 Mo maximum.");
      }
      const id = await startVisitorConversation(
        document.getElementById("chat-visitor-name").value.trim(),
        document.getElementById("chat-first-message").value.trim()
      );
      document.getElementById("chat-new-form").reset();
      if (file) {
        try {
          await sendChatAttachment(id, file, "", "visitor");
        } catch (error) {
          const conversation = (await fetchVisitorConversations()).find(item => item.id === id);
          if (conversation) await openVisitorConversation(conversation);
          throw error;
        }
      }
      const conversation = (await fetchVisitorConversations()).find(item => item.id === id);
      if (!conversation) throw new Error("La conversation a été créée mais ne peut pas être affichée.");
      await openVisitorConversation(conversation);
    } catch (error) {
      setChatError(error);
    } finally {
      button.disabled = false;
    }
  });
  document.getElementById("chat-reply-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (!selectedConversationId) return;
    const input = document.getElementById("chat-reply-input");
    const body = input.value.trim();
    const fileInput = document.getElementById("chat-reply-file");
    const file = fileInput.files[0];
    if (!body && !file) return;
    try {
      if (file) await sendChatAttachment(selectedConversationId, file, body, "visitor");
      else {
        const { error } = await getSupabase().from("chat_messages").insert({
          conversation_id: selectedConversationId,
          sender_id: currentUser.id,
          sender_role: "visitor",
          body
        });
        if (error) throw error;
      }
      input.value = "";
      fileInput.value = "";
      const conversations = await fetchVisitorConversations();
      const conversation = conversations.find(item => item.id === selectedConversationId);
      if (conversation) await openVisitorConversation(conversation);
    } catch (error) {
      setChatError(error);
    }
  });
}

function appendLocalAiWidget() {
  const root = document.createElement("div");
  root.id = "site-local-ai";
  root.innerHTML = `
    <button class="local-ai-launcher" id="local-ai-launcher" type="button" aria-label="Ouvrir l’assistant IA" aria-expanded="false">
      <i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i><span>Assistant IA</span>
    </button>
    <section class="local-ai-panel" id="local-ai-panel" role="dialog" aria-modal="false" aria-labelledby="local-ai-title" hidden>
      <header class="chat-panel-header">
        <div><span class="chat-eyebrow">Ollama · Qwen 2.5</span><h2 id="local-ai-title">Assistant IA</h2></div>
        <button class="chat-close" id="local-ai-close" type="button" aria-label="Fermer l’assistant IA">×</button>
      </header>
      <div class="local-ai-content">
        <p class="local-ai-notice" id="local-ai-notice"></p>
        <div class="local-ai-thread" id="local-ai-thread" aria-live="polite"></div>
        <p class="local-ai-feedback" id="local-ai-feedback" role="status" aria-live="polite"></p>
        <form class="local-ai-form" id="local-ai-form">
          <label class="visually-hidden" for="local-ai-input">Votre question</label>
          <textarea id="local-ai-input" maxlength="4000" required placeholder="Posez votre question…"></textarea>
          <button id="local-ai-send" type="submit" aria-label="Envoyer la question"><i class="fa-solid fa-paper-plane" aria-hidden="true"></i></button>
        </form>
      </div>
    </section>`;
  document.body.appendChild(root);
}

async function initializeLocalAiWidget() {
  appendLocalAiWidget();
  const panel = document.getElementById("local-ai-panel");
  const launcher = document.getElementById("local-ai-launcher");
  const thread = document.getElementById("local-ai-thread");
  const feedback = document.getElementById("local-ai-feedback");
  const form = document.getElementById("local-ai-form");
  const input = document.getElementById("local-ai-input");
  const sendButton = document.getElementById("local-ai-send");
  const notice = document.getElementById("local-ai-notice");
  const history = [];
  const isLevelFive = Boolean(currentAgent?.is_active && currentAgent.access_level >= 5);
  const userLimit = isLevelFive ? 4000 : 1200;
  const allowedAssistantLinks = [
    "https://discord.gg/eevSpR8nHW",
    "https://docs.google.com/document/d/1nsfiP6qqsed5CwKM3U4wb5mXT5itAcbr6dlmEH2UNjw/edit?usp=sharing"
  ];

  input.maxLength = userLimit;
  input.placeholder = isLevelFive
    ? "Posez votre question…"
    : "Question sur les informations publiques du site…";
  notice.textContent = isLevelFive
    ? "Mode niveau 5 · Questions générales. Aucun dossier n’est transmis à l’IA."
    : "Réponses limitées aux informations publiques du site. L’assistant ne consulte aucun dossier.";

  const addMessage = (role, content) => {
    const message = document.createElement("div");
    message.className = `local-ai-message ${role === "user" ? "from-user" : "from-assistant"}`;
    if (role === "user") {
      message.textContent = content;
    } else {
      const linkPattern = /(https:\/\/discord\.gg\/eevSpR8nHW|https:\/\/docs\.google\.com\/document\/d\/1nsfiP6qqsed5CwKM3U4wb5mXT5itAcbr6dlmEH2UNjw\/edit\?usp=sharing|misanthrope45 sur Discord)/g;
      let cursor = 0;
      for (const match of content.matchAll(linkPattern)) {
        message.appendChild(document.createTextNode(content.slice(cursor, match.index)));
        const anchor = document.createElement("a");
        anchor.href = match[0] === "misanthrope45 sur Discord"
          ? allowedAssistantLinks[0]
          : match[0];
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
        anchor.textContent = match[0];
        message.appendChild(anchor);
        cursor = match.index + match[0].length;
      }
      message.appendChild(document.createTextNode(content.slice(cursor)));
    }
    thread.appendChild(message);
    thread.scrollTop = thread.scrollHeight;
  };

  addMessage(
    "assistant",
    isLevelFive
      ? "Je peux répondre aux questions générales grâce au modèle local de ce PC."
      : "Je peux aider à comprendre les pages et les informations publiques du Site 11."
  );

  const setOpen = open => {
    panel.hidden = !open;
    launcher.setAttribute("aria-expanded", String(open));
    if (open) input.focus();
  };
  launcher.addEventListener("click", () => setOpen(panel.hidden));
  document.getElementById("local-ai-close").addEventListener("click", () => setOpen(false));

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const question = input.value.trim();
    if (!question || question.length > userLimit || sendButton.disabled) return;

    addMessage("user", question);
    history.push({ role: "user", content: question });
    input.value = "";
    sendButton.disabled = true;
    feedback.textContent = "L’IA prépare sa réponse sur ce PC…";
    feedback.classList.remove("success");

    try {
      const client = getSupabase();
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      const token = data.session?.access_token;
      const response = await fetch("http://127.0.0.1:11435/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ messages: history.slice(-10) }),
        signal: AbortSignal.timeout(180000)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `Le service IA a répondu avec le code ${response.status}.`);
      if (typeof result.content !== "string" || !result.content.trim()) {
        throw new Error("Le modèle n’a pas renvoyé de réponse.");
      }
      history.push({ role: "assistant", content: result.content });
      addMessage("assistant", result.content);
      feedback.textContent = "";
    } catch (error) {
      console.error("Impossible d’interroger l’assistant IA local :", error);
      feedback.textContent = error.name === "TimeoutError" || error.name === "AbortError"
        ? "La réponse a dépassé le délai. Réessayez avec une question plus courte."
        : error instanceof TypeError
          ? "Service IA local introuvable. Vérifiez qu’Ollama et le relais local sont démarrés sur ce PC."
          : error.message || "Impossible d’obtenir une réponse de l’IA.";
    } finally {
      sendButton.disabled = false;
      input.focus();
    }
  });
}

async function invokeAgentFunction(payload) {
  const { data, error } = await getSupabase().functions.invoke("manage-agent", { body: payload });
  if (error) {
    if (error.name === "FunctionsHttpError" && error.context?.status === 404) {
      throw new Error("La fonction manage-agent n’est pas déployée sur Supabase. Déployez-la avec : supabase functions deploy manage-agent --project-ref kvqndpgbazthslvyollb");
    }
    if (error.name === "FunctionsFetchError") {
      throw new Error("Supabase ne parvient pas à joindre la fonction manage-agent. Vérifiez son déploiement et l’état du service Supabase.");
    }
    if (error.context instanceof Response) {
      let responseMessage = "";
      try {
        const body = await error.context.clone().json();
        responseMessage = body.error || body.message || "";
      } catch {
        responseMessage = "";
      }
      if (responseMessage) throw new Error(responseMessage);
    }
    throw error;
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

async function fetchAgents() {
  const { data, error } = await getSupabase()
    .from("agent_profiles")
    .select("id, email, full_name, access_level, is_active, is_super_admin, created_at")
    .order("created_at", { ascending: true });
  if (error) throw error;

  const tbody = document.getElementById("agents-table-body");
  tbody.replaceChildren();
  for (const agent of data ?? []) {
    const row = document.createElement("tr");
    row.appendChild(createCell(agent.full_name));
    row.appendChild(createCell(agent.email));
    row.appendChild(createCell(`Niveau ${agent.access_level}`));
    row.appendChild(createCell(agent.is_active ? "Actif" : "Désactivé", agent.is_active ? "status-active" : "status-inactive"));
    const actions = document.createElement("td");
    const canManage = currentAgent.is_super_admin ||
      (agent.id !== currentUser.id && !agent.is_super_admin && agent.access_level < currentAgent.access_level);
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "btn-edit";
    edit.textContent = "Modifier";
    edit.disabled = !canManage;
    edit.title = canManage
      ? "Modifier ce compte"
      : agent.id === currentUser.id
        ? "Vous ne pouvez pas modifier votre propre compte."
        : "Les comptes de même niveau, supérieurs ou officiels sont protégés.";
    edit.addEventListener("click", () => {
      if (canManage) openAgentModal(agent);
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn-del";
    remove.textContent = "Supprimer";
    const canDelete = canManage && !agent.is_super_admin;
    remove.disabled = !canDelete;
    remove.title = canDelete ? "Supprimer ce compte" : "Ce compte ne peut pas être supprimé par cet agent.";
    remove.addEventListener("click", () => {
      if (canDelete) deleteAgent(agent);
    });
    actions.append(edit, remove);
    row.appendChild(actions);
    tbody.appendChild(row);
  }
}

function openAgentModal(agent = null) {
  if (agent && !currentAgent.is_super_admin &&
      (agent.id === currentUser.id || agent.is_super_admin || agent.access_level >= currentAgent.access_level)) {
    setFeedback("agents-feedback", "Vous ne pouvez pas modifier un compte de votre niveau ou d’un niveau supérieur.");
    return;
  }
  const form = document.getElementById("agent-form");
  form.reset();
  document.getElementById("agent-id").value = agent?.id ?? "";
  document.getElementById("agent-modal-title").textContent = agent ? "Modifier un compte" : "Créer un compte";
  document.getElementById("agent-name").value = agent?.full_name ?? "";
  document.getElementById("agent-email").value = agent?.email ?? "";
  document.getElementById("agent-level").value = String(agent?.access_level ?? 1);
  Array.from(document.getElementById("agent-level").options).forEach(option => {
    option.disabled = !currentAgent.is_super_admin && Number(option.value) >= currentAgent.access_level;
  });
  document.getElementById("agent-active").checked = agent?.is_active ?? true;
  const password = document.getElementById("agent-password");
  password.required = !agent;
  password.value = "";
  password.placeholder = agent ? "Laisser vide pour ne pas modifier" : "12 caractères minimum";
  document.getElementById("agent-modal").classList.add("open");
  document.getElementById("agent-name").focus();
}

function closeAgentModal() {
  document.getElementById("agent-modal").classList.remove("open");
  document.getElementById("agent-form").reset();
}

async function handleAgentSubmit(event) {
  event.preventDefault();
  const id = document.getElementById("agent-id").value;
  const password = document.getElementById("agent-password").value;
  const payload = {
    action: id ? "update" : "create",
    id: id || undefined,
    full_name: document.getElementById("agent-name").value.trim(),
    email: document.getElementById("agent-email").value.trim(),
    access_level: Number(document.getElementById("agent-level").value),
    is_active: document.getElementById("agent-active").checked
  };
  if (password) payload.password = password;

  try {
    await invokeAgentFunction(payload);
    closeAgentModal();
    setFeedback("agents-feedback", "Compte enregistré et action journalisée.", false);
    await fetchAgents();
  } catch (error) {
    setFeedback("agent-form-feedback", friendlyError(error));
  }
}

async function deleteAgent(agent) {
  if (!currentAgent.is_super_admin &&
      (agent.id === currentUser.id || agent.is_super_admin || agent.access_level >= currentAgent.access_level)) {
    setFeedback("agents-feedback", "Vous ne pouvez pas supprimer un compte de votre niveau ou d’un niveau supérieur.");
    return;
  }
  if (!confirm(`Supprimer le compte de ${agent.full_name} (${agent.email}) ? Cette action est irréversible.`)) return;
  try {
    await invokeAgentFunction({ action: "delete", id: agent.id });
    setFeedback("agents-feedback", "Compte supprimé et action journalisée.", false);
    await fetchAgents();
  } catch (error) {
    setFeedback("agents-feedback", friendlyError(error));
  }
}

async function fetchActivityLogs() {
  const { data, error } = await getSupabase()
    .from("activity_logs")
    .select("actor_email, action, target_type, target_id, details, created_at")
    .order("created_at", { ascending: false })
    .limit(250);
  if (error) throw error;

  const tbody = document.getElementById("activity-table-body");
  tbody.replaceChildren();
  for (const entry of data ?? []) {
    const row = document.createElement("tr");
    row.appendChild(createCell(new Date(entry.created_at).toLocaleString("fr-FR")));
    row.appendChild(createCell(entry.actor_email));
    row.appendChild(createCell(entry.action));
    row.appendChild(createCell(`${entry.target_type} ${entry.target_id ?? ""}`.trim()));
    row.appendChild(createCell(JSON.stringify(entry.details)));
    tbody.appendChild(row);
  }
  if (!data?.length) {
    const row = document.createElement("tr");
    const cell = createCell("Aucune activité enregistrée.");
    cell.colSpan = 5;
    row.appendChild(cell);
    tbody.appendChild(row);
  }
}

async function initializeDashboard() {
  await loadCurrentAgent();
  const editToggle = document.getElementById("toggle-dossier-edit");
  if (editToggle) {
    editToggle.hidden = !currentAgent;
    editToggle.addEventListener("click", () => setDossierEditMode(!dossierEditMode));
  }
  const addButton = document.getElementById("open-modal");
  if (addButton) addButton.addEventListener("click", () => openDossierModal());
  const exportCsv = document.getElementById("export-csv");
  const exportPdf = document.getElementById("export-pdf");
  const archiveToggle = document.getElementById("toggle-archives");
  const privileged = Boolean(currentAgent && currentAgent.access_level >= 4);
  if (exportCsv) {
    exportCsv.hidden = !privileged;
    exportCsv.addEventListener("click", exportDossiersCsv);
  }
  if (exportPdf) {
    exportPdf.hidden = !privileged;
    exportPdf.addEventListener("click", exportDossiersPdf);
  }
  if (archiveToggle) {
    archiveToggle.hidden = !privileged;
    archiveToggle.addEventListener("click", async () => {
      showArchivedDossiers = !showArchivedDossiers;
      archiveToggle.innerHTML = `<i class="fa-solid ${showArchivedDossiers ? "fa-box-open" : "fa-box-archive"}" aria-hidden="true"></i> ${showArchivedDossiers ? "Afficher les dossiers actifs" : "Afficher les archives"}`;
      await fetchDossiers().catch(error => setFeedback("dashboard-feedback", friendlyError(error)));
    });
  }
  document.getElementById("dossier-search").addEventListener("input", renderDossiers);
  document.getElementById("filter-level").addEventListener("change", renderDossiers);
  document.getElementById("filter-status").addEventListener("change", renderDossiers);
  document.getElementById("close-history").addEventListener("click", () => {
    const historyModal = document.getElementById("history-modal");
    historyModal.hidden = true;
    historyModal.classList.remove("open");
  });
  document.getElementById("history-modal").addEventListener("click", event => {
    if (event.target.id === "history-modal") {
      event.currentTarget.hidden = true;
      event.currentTarget.classList.remove("open");
    }
  });
  const form = document.getElementById("dossier-form");
  if (form) form.addEventListener("submit", handleDossierSubmit);
  const closeButton = document.getElementById("close-modal");
  if (closeButton) closeButton.addEventListener("click", closeDossierModal);
  const cancelButton = document.getElementById("cancel-modal");
  if (cancelButton) cancelButton.addEventListener("click", closeDossierModal);
  const statusSelect = document.getElementById("form-statut");
  if (statusSelect) statusSelect.addEventListener("change", () => {
    const levelSelect = document.getElementById("form-niveau");
    if (statusSelect.value === "Classified") {
      levelSelect.value = "Niveau 5";
      levelSelect.disabled = true;
    } else {
      levelSelect.disabled = false;
      if (!editingDossierId && currentAgent) {
        levelSelect.value = `Niveau ${currentAgent.access_level}`;
      }
    }
  });
  const modal = document.getElementById("add-modal");
  if (modal) {
    modal.addEventListener("click", event => {
      if (event.target === modal) closeDossierModal();
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        closeDossierModal();
        const historyModal = document.getElementById("history-modal");
        historyModal.hidden = true;
        historyModal.classList.remove("open");
      }
    });
  }
  document.getElementById("table-actions-heading").hidden = !privileged;
  await fetchDossiers();
}

async function initializeAgentsPage() {
  const agentLevel = await loadCurrentAgent();
  if (!agentLevel || (agentLevel.access_level < 5 && !agentLevel.is_super_admin)) {
    window.location.replace("dashboard.html");
    return;
  }
  document.getElementById("open-agent-modal").addEventListener("click", () => openAgentModal());
  document.getElementById("agent-form").addEventListener("submit", handleAgentSubmit);
  document.getElementById("close-agent-modal").addEventListener("click", closeAgentModal);
  document.getElementById("cancel-agent-modal").addEventListener("click", closeAgentModal);
  document.getElementById("agent-modal").addEventListener("click", event => {
    if (event.target.id === "agent-modal") closeAgentModal();
  });
  try {
    await fetchAgents();
  } catch (error) {
    setFeedback("agents-feedback", friendlyError(error));
  }
}

async function initializeActivityPage() {
  const agent = await loadCurrentAgent();
  if (!agent || agent.access_level < 4) {
    window.location.replace("dashboard.html");
    return;
  }
  try {
    await fetchActivityLogs();
  } catch (error) {
    setFeedback("activity-feedback", friendlyError(error));
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  const logoutButton = document.getElementById("logout-button");
  if (logoutButton) logoutButton.addEventListener("click", logout);

  const loginForm = document.getElementById("login-form");
  if (loginForm) loginForm.addEventListener("submit", async event => {
    event.preventDefault();
    try {
      await handleLogin(event);
    } catch (error) {
      setFeedback("login-feedback", friendlyError(error));
    }
  });

  if (!AR_CONFIG.supabaseUrl || !AR_CONFIG.supabaseAnonKey) {
    const message = "Configurez l’URL Supabase et la clé publique dans config.js.";
    if (loginForm) setFeedback("login-feedback", message);
    if (document.getElementById("dossiers-table-body")) setFeedback("dashboard-feedback", message);
    if (document.getElementById("agents-table-body")) setFeedback("agents-feedback", message);
    if (document.getElementById("activity-table-body")) setFeedback("activity-feedback", message);
    await initializeChatWidget();
    await initializeLocalAiWidget();
    return;
  }

  try {
    await loadCurrentAgent();
    await initializeAgentNotifications();
    try {
      if (await enforceMaintenance()) return;
    } catch (maintenanceError) {
      console.error("Impossible de vérifier l’état de maintenance :", maintenanceError);
      showMaintenanceCheckWarning(maintenanceError);
    }

    if (document.getElementById("dossiers-table-body")) await initializeDashboard();
    else if (document.getElementById("agents-table-body")) await initializeAgentsPage();
    else if (document.getElementById("activity-table-body")) await initializeActivityPage();
    else if (document.getElementById("messages-conversation-list")) await initializeMessagesPage();
    else if (document.getElementById("maintenance-controls")) await initializeMaintenancePage();
    else {
      await initializeContactForm();
      const agent = await loadCurrentAgent();
      if (loginForm && agent) window.location.replace("dashboard.html");
    }
  } catch (error) {
    console.error("Erreur lors du chargement du portail :", error);
    if (loginForm) setFeedback("login-feedback", friendlyError(error));
    if (document.getElementById("dashboard-feedback")) setFeedback("dashboard-feedback", friendlyError(error));
    if (document.getElementById("agents-feedback")) setFeedback("agents-feedback", friendlyError(error));
    if (document.getElementById("activity-feedback")) setFeedback("activity-feedback", friendlyError(error));
    if (document.getElementById("maintenance-feedback")) setFeedback("maintenance-feedback", friendlyError(error));
  }
  await initializeChatWidget();
  await initializeLocalAiWidget();
});

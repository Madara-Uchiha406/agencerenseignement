let supabaseClient = null;
let currentUser = null;
let currentAgent = null;
let editingDossierId = null;
let dossierEditMode = false;

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
  supabaseClient = window.supabase.createClient(AR_CONFIG.supabaseUrl, AR_CONFIG.supabaseAnonKey);
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
  if (error.code === "42501" || error.status === 403) return "Votre niveau d’accès ne permet pas cette action.";
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
  document.getElementById("stat-total").textContent = String(rows.length);
  document.getElementById("stat-active").textContent = String(
    rows.filter(row => row.statut === "En cours de traitement").length
  );
  document.getElementById("stat-levels").textContent = String(new Set(rows.map(row => row.niveau)).size);
}

async function fetchDossiers() {
  const { data, error } = await getSupabase()
    .from("dossiers")
    .select("id, code, sujet, niveau, statut, created_at")
    .order("id", { ascending: false });
  if (error) throw error;

  const rows = data ?? [];
  updateDashboardStats(rows);
  const tbody = document.getElementById("dossiers-table-body");
  tbody.replaceChildren();

  if (!rows.length) {
    const emptyRow = document.createElement("tr");
    const emptyCell = createCell(currentUser
      ? "Aucun dossier accessible à votre niveau."
      : "Aucun dossier public pour le moment.");
    emptyCell.colSpan = dossierEditMode ? 5 : 4;
    emptyCell.className = "empty-state";
    emptyRow.appendChild(emptyCell);
    tbody.appendChild(emptyRow);
    return;
  }

  for (const dossier of rows) {
    const row = document.createElement("tr");
    row.appendChild(createCell(dossier.code, "code-text"));
    row.appendChild(createCell(dossier.sujet));
    const levelCell = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = `Niveau ${dossier.niveau}`;
    levelCell.appendChild(badge);
    row.appendChild(levelCell);
    row.appendChild(createCell(dossier.statut));

    if (dossierEditMode) {
      const actions = document.createElement("td");
      const edit = document.createElement("button");
      edit.className = "btn-edit";
      edit.type = "button";
      edit.setAttribute("aria-label", `Modifier le dossier ${dossier.code}`);
      edit.innerHTML = '<i class="fa-solid fa-pen" aria-hidden="true"></i>';
      edit.addEventListener("click", () => openDossierModal(dossier));
      const remove = document.createElement("button");
      remove.className = "btn-del";
      remove.type = "button";
      remove.setAttribute("aria-label", `Supprimer le dossier ${dossier.code}`);
      remove.innerHTML = '<i class="fa-solid fa-trash" aria-hidden="true"></i>';
      remove.addEventListener("click", () => deleteDossier(dossier));
      actions.append(edit, remove);
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

async function deleteDossier(dossier) {
  if (!confirm(`Supprimer définitivement le dossier ${dossier.code} ?`)) return;
  const { data, error } = await getSupabase()
    .from("dossiers")
    .delete()
    .eq("id", dossier.id)
    .select("id");
  if (error) {
    setFeedback("dashboard-feedback", friendlyError(error));
    return;
  }
  if (!data?.length) {
    setFeedback("dashboard-feedback", "Dossier non supprimé : votre niveau d’accès est insuffisant.");
    return;
  }
  setFeedback("dashboard-feedback", `Dossier ${dossier.code} supprimé.`, false);
  await fetchDossiers();
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
  if (actionsHeading) actionsHeading.hidden = !enabled;
  fetchDossiers().catch(error => setFeedback("dashboard-feedback", friendlyError(error)));
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

async function ensureVisitorSession() {
  const client = getSupabase();
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
  const { data: anonymousData, error: anonymousError } = await client.auth.signInAnonymously();
  if (anonymousError) {
    throw new Error("La messagerie visiteur n’est pas activée. Activez Anonymous Sign-Ins dans Supabase Authentication > Sign In / Providers.");
  }
  currentUser = anonymousData.user;
  currentAgent = null;
  return currentUser;
}

function renderChatMessageList(container, messages, agentView) {
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
    .select("id, sender_id, sender_role, body, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

async function startVisitorConversation(name, body) {
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
      renderChatMessageList(thread, await fetchConversationMessages(id), true);
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
    if (!body) return;
    try {
      const { error } = await getSupabase().from("chat_messages").insert({
        conversation_id: selectedId,
        sender_id: currentUser.id,
        sender_role: "agent",
        body
      });
      if (error) throw error;
      input.value = "";
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
          <p class="chat-privacy">Vos conversations restent accessibles dans ce navigateur.</p>
        </div>
        <div class="chat-detail-view" id="chat-detail-view" hidden>
          <button class="chat-back-button" id="chat-back-button" type="button"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i> Toutes les conversations</button>
          <div class="chat-current-heading"><span class="chat-status" id="chat-current-status"></span><strong id="chat-current-name"></strong></div>
          <div class="chat-thread" id="chat-thread" aria-live="polite"></div>
          <form class="chat-reply-form" id="chat-reply-form"><label class="visually-hidden" for="chat-reply-input">Votre message</label><textarea id="chat-reply-input" maxlength="4000" required placeholder="Écrivez votre message…"></textarea><button type="submit" aria-label="Envoyer le message"><i class="fa-solid fa-paper-plane" aria-hidden="true"></i></button></form>
        </div>
        <form class="chat-new-view" id="chat-new-form" hidden>
          <button class="chat-back-button" id="chat-new-back" type="button"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i> Toutes les conversations</button>
          <label for="chat-visitor-name">Votre nom</label><input id="chat-visitor-name" maxlength="100" required autocomplete="name" placeholder="Nom ou pseudonyme">
          <label for="chat-first-message">Votre message</label><textarea id="chat-first-message" maxlength="4000" required placeholder="Comment pouvons-nous vous aider ?"></textarea>
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
      await ensureVisitorSession();
      setChatError(null);
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
      renderChatMessageList(thread, messages, false);
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
    try {
      const id = await startVisitorConversation(
        document.getElementById("chat-visitor-name").value.trim(),
        document.getElementById("chat-first-message").value.trim()
      );
      document.getElementById("chat-new-form").reset();
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
    if (!body) return;
    try {
      const { error } = await getSupabase().from("chat_messages").insert({
        conversation_id: selectedConversationId,
        sender_id: currentUser.id,
        sender_role: "visitor",
        body
      });
      if (error) throw error;
      input.value = "";
      const conversations = await fetchVisitorConversations();
      const conversation = conversations.find(item => item.id === selectedConversationId);
      if (conversation) await openVisitorConversation(conversation);
    } catch (error) {
      setChatError(error);
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
      if (event.key === "Escape") closeDossierModal();
    });
  }
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
    return;
  }

  try {
    await loadCurrentAgent();
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
});

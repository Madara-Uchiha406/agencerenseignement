(() => {
  const THEMES = ["halloween", "armistice", "easter", "bastille"];
  const EASTER_EGG_PAGES = new Map([
    ["index.html", { id: "informations", left: 78, progress: .58 }],
    ["dashboard.html", { id: "dashboard", left: 16, progress: .72 }],
    ["contact.html", { id: "contact", left: 82, progress: .48 }],
    ["connexion.html", { id: "connexion", left: 20, progress: .7 }],
    ["status.html", { id: "status", left: 75, progress: .68 }]
  ]);
  const STORAGE_KEY = "site11-easter-hunt-v1";
  let stopFireworks = null;

  function easterSunday(year) {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month - 1, day);
  }

  function getTheme(date = new Date()) {
    const month = date.getMonth();
    const day = date.getDate();
    if (month === 10) return day === 11 ? "armistice" : "halloween";
    if (month === 6 && day === 14) return "bastille";
    const easter = easterSunday(date.getFullYear());
    const easterMonday = new Date(easter.getFullYear(), easter.getMonth(), easter.getDate() + 1);
    if ((month === easter.getMonth() && day === easter.getDate())
      || (month === easterMonday.getMonth() && day === easterMonday.getDate())) return "easter";
    return null;
  }

  function createBastilleIllustration() {
    const illustration = document.createElement("div");
    illustration.className = "seasonal-bastille";
    illustration.setAttribute("aria-hidden", "true");
    illustration.innerHTML = '<svg viewBox="0 0 280 116" focusable="false"><path d="M20 104h240M40 104V50l28-18 28 18v54m16 0V38l28-20 28 20v66m16 0V50l28-18 28 18v54M32 50h72m8-12h56m8 12h72M28 104h224" fill="none" stroke="currentColor" stroke-width="5" stroke-linejoin="round"/><path d="M60 104V77h17v27m48 0V65h17v39m48 0V77h17v27" fill="none" stroke="currentColor" stroke-width="4"/></svg><span>14 JUILLET · LIBERTÉ</span>';
    return illustration;
  }

  function themeCopy(theme) {
    return {
      halloween: ["Nuit d’Halloween", "Citrouilles, chauves-souris et mystères se sont invités au Site 11."],
      armistice: ["11 novembre · Souvenir", "En mémoire de celles et ceux qui ont vécu et traversé la Grande Guerre."],
      easter: ["Chasse aux œufs du Site 11", "Quelques œufs en chocolat se sont cachés dans les pages. Saurez-vous tous les trouver ?"],
      bastille: ["14 juillet · Fête nationale", "Le Site 11 célèbre la République, la liberté et la fête nationale."]
    }[theme];
  }

  function readCollectedEggs() {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === null) return [];
    const value = JSON.parse(stored);
    if (!Array.isArray(value) || value.some(id => typeof id !== "string")) {
      throw new Error("Les données sauvegardées de la chasse aux œufs sont invalides.");
    }
    return [...new Set(value)].filter(id => [...EASTER_EGG_PAGES.values()].some(egg => egg.id === id));
  }

  function renderEggHunt(root, pageKey) {
    const status = document.createElement("div");
    status.className = "easter-hunt-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    root.append(status);

    let collected;
    try {
      collected = readCollectedEggs();
    } catch (error) {
      console.error("Impossible de lire la progression de la chasse aux œufs :", error);
      status.textContent = "Collecte indisponible : la progression locale n’a pas pu être lue.";
      return;
    }

    const updateStatus = message => {
      status.textContent = message || `Œufs récoltés : ${collected.length}/${EASTER_EGG_PAGES.size}`;
    };
    updateStatus();

    const egg = EASTER_EGG_PAGES.get(pageKey);
    if (!egg || collected.includes(egg.id)) return;

    const button = document.createElement("button");
    button.className = "hidden-easter-egg";
    button.type = "button";
    button.textContent = "🥚";
    button.setAttribute("aria-label", "Récolter l’œuf caché sur cette page");
    button.title = "Un œuf en chocolat est caché ici";
    button.style.left = `${egg.left}%`;
    button.style.top = `${Math.max(240, document.documentElement.scrollHeight * egg.progress)}px`;
    button.addEventListener("click", () => {
      try {
        collected = readCollectedEggs();
        if (!collected.includes(egg.id)) {
          collected.push(egg.id);
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(collected));
        }
        button.remove();
        updateStatus(`Bien trouvé ! Œufs récoltés : ${collected.length}/${EASTER_EGG_PAGES.size}`);
      } catch (error) {
        console.error("Impossible d’enregistrer l’œuf récolté :", error);
        updateStatus("Impossible d’enregistrer cet œuf dans le stockage local.");
      }
    });
    root.append(button);
  }

  function startBastilleFireworks(canvas) {
    const context = canvas.getContext("2d");
    if (!context) {
      console.error("Le canvas des feux d’artifice du 14 juillet n’est pas disponible.");
      return () => {};
    }
    const colors = ["#21468b", "#ffffff", "#ed2939", "#ffd166"];
    const particles = [];
    let width = 0;
    let height = 0;
    let lastFrame = 0;
    let nextBurst = 0;
    let frame = 0;

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width;
      canvas.height = height;
    };
    const burst = () => {
      const x = width * (.12 + Math.random() * .76);
      const y = height * (.08 + Math.random() * .4);
      const color = colors[Math.floor(Math.random() * colors.length)];
      for (let index = 0; index < 24 && particles.length < 48; index += 1) {
        const angle = Math.PI * 2 * index / 24;
        const speed = 1 + Math.random() * 2.8;
        particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 42, color });
      }
    };
    const draw = timestamp => {
      if (document.hidden) return;
      if (timestamp - lastFrame < 1000 / 24) {
        frame = requestAnimationFrame(draw);
        return;
      }
      lastFrame = timestamp;
      context.clearRect(0, 0, width, height);
      if (timestamp >= nextBurst) {
        burst();
        nextBurst = timestamp + 2200 + Math.random() * 1200;
      }
      for (let index = particles.length - 1; index >= 0; index -= 1) {
        const particle = particles[index];
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.vx *= .985;
        particle.vy = particle.vy * .985 + .035;
        particle.life -= 1;
        if (particle.life <= 0) {
          particles.splice(index, 1);
          continue;
        }
        context.globalAlpha = particle.life / 42;
        context.fillStyle = particle.color;
        context.beginPath();
        context.arc(particle.x, particle.y, 2, 0, Math.PI * 2);
        context.fill();
      }
      context.globalAlpha = 1;
      frame = requestAnimationFrame(draw);
    };
    const onVisibilityChange = () => {
      cancelAnimationFrame(frame);
      particles.length = 0;
      if (!document.hidden) {
        nextBurst = performance.now() + 1200;
        frame = requestAnimationFrame(draw);
      } else {
        context.clearRect(0, 0, width, height);
      }
    };

    resize();
    window.addEventListener("resize", resize, { passive: true });
    document.addEventListener("visibilitychange", onVisibilityChange);
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      particles.length = 0;
    };
  }

  function initialize(date = new Date()) {
    const theme = getTheme(date);
    const currentLayer = document.getElementById("seasonal-theme-layer");
    if (currentLayer?.dataset.theme === theme) return theme;

    stopFireworks?.();
    stopFireworks = null;
    currentLayer?.remove();
    document.body.classList.remove(...THEMES.map(name => `seasonal-${name}`));
    if (!theme) return null;

    document.body.classList.add(`seasonal-${theme}`);
    const layer = document.createElement("div");
    layer.id = "seasonal-theme-layer";
    layer.className = "seasonal-theme-layer";
    layer.dataset.theme = theme;
    layer.setAttribute("aria-label", "Décor saisonnier du Site 11");
    const [title, description] = themeCopy(theme);
    const banner = document.createElement("div");
    banner.className = "seasonal-banner";
    banner.setAttribute("role", "status");
    const bannerTitle = document.createElement("strong");
    bannerTitle.textContent = title;
    const bannerDescription = document.createElement("span");
    bannerDescription.textContent = description;
    banner.append(bannerTitle, bannerDescription);
    layer.append(banner);

    if (theme === "halloween") {
      const decorations = document.createElement("div");
      decorations.className = "seasonal-decorations halloween-decorations";
      decorations.setAttribute("aria-hidden", "true");
      decorations.innerHTML = '<span>🎃</span><span>🦇</span><span>🦇</span><span>🎃</span>';
      layer.append(decorations);
    } else if (theme === "armistice") {
      const decorations = document.createElement("div");
      decorations.className = "seasonal-decorations armistice-decorations";
      decorations.setAttribute("aria-hidden", "true");
      decorations.innerHTML = '<span class="armistice-poppy">✿</span><span class="armistice-graves">✝　✝　✝</span><span class="armistice-helmet">⛑</span>';
      layer.append(decorations);
    } else if (theme === "easter") {
      const decorations = document.createElement("div");
      decorations.className = "seasonal-decorations easter-decorations";
      decorations.setAttribute("aria-hidden", "true");
      decorations.innerHTML = '<span>🍫</span><span>🐇</span><span>🍫</span>';
      layer.append(decorations);
      const pageKey = window.location.pathname.split("/").filter(Boolean).pop() || "index.html";
      renderEggHunt(layer, pageKey);
    } else if (theme === "bastille") {
      layer.append(createBastilleIllustration());
      if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        const canvas = document.createElement("canvas");
        canvas.className = "seasonal-fireworks";
        canvas.setAttribute("aria-hidden", "true");
        layer.append(canvas);
        stopFireworks = startBastilleFireworks(canvas);
      }
    }
    document.body.prepend(layer);
    return theme;
  }

  window.Site11SeasonalTheme = { getTheme, initialize, easterSunday };
  document.addEventListener("DOMContentLoaded", () => initialize());
})();

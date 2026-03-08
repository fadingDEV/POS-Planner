const DAMAGE_TYPES = ["em", "thermal", "kinetic", "explosive"];
const DAMAGE_TYPE_META = {
  em: { label: "EM", shortLabel: "EM", icon: "./public/img/EM.png", alt: "EM" },
  thermal: { label: "Thermal", shortLabel: "TH", icon: "./public/img/Thermal.png", alt: "Thermal" },
  kinetic: { label: "Kinetic", shortLabel: "KI", icon: "./public/img/Kinetic.png", alt: "Kinetic" },
  explosive: { label: "Explosive", shortLabel: "EX", icon: "./public/img/Explosive.png", alt: "Explosive" },
};

const MODULE_GROUP_LABELS = {
  production: "Production",
  defence: "Defense",
  defense: "Defense",
  ecm: "ECM",
  ewar: "EWAR",
  shieldHardening: "Shield Hardening",
  deprecated: "Deprecated",
  "deprecated-limited": "Partially Deprecated",
  services: "Services",
  service: "Services",
};

const MODULE_TABS = [
  { id: "defence", label: "Defense" },
  { id: "ecm", label: "ECM" },
  { id: "ewar", label: "EWAR" },
  { id: "shieldHardening", label: "Shield Hardening" },
  { id: "production", label: "Production" },
  { id: "services", label: "Services" },
  { id: "deprecated", label: "Deprecated" },
  { id: "deprecated-limited", label: "Partially Deprecated" },
];

const MODULE_STATUS_META = {
  active: {
    label: "Active",
    className: "status-badge status-badge--active",
    issue: "This module is active and has no known special restrictions.",
  },
  warn: {
    label: "Warning",
    className: "status-badge status-badge--warn",
    issue: "This module is flagged with a warning. Review current market and operational status before deployment.",
  },
  deprecated: {
    label: "Deprecated",
    className: "status-badge status-badge--danger",
    issue: "Deprecated: this module is legacy and should be avoided for new fittings when possible.",
  },
  "deprecated-limited": {
    label: "Deprecated (Limited)",
    className: "status-badge status-badge--limited",
    issue: "Partially deprecated: module is still usable in specific contexts but has known lifecycle limitations.",
  },
};

const SHIELD_HARDENER_DEFAULT_BONUS = 0.25;
const SHIELD_HARDENER_TYPE_BONUSES = {
  kinetic: 0.25,
  explosive: 0.25,
  thermal: 0.25,
  em: 0.25,
};
const SHIELD_HARDENER_TYPES = {
  "ballistic deflection": "kinetic",
  "explosion dampening": "explosive",
  "heat dissipation": "thermal",
  "photon scattering": "em",
};
const ECM_MODULE_PATTERNS = [
  /\bion field projection battery\b/i,
  /\bphase inversion battery\b/i,
  /\bspatial destabilization battery\b/i,
  /\bwhite noise generation battery\b/i,
];
const EWAR_MODULE_PATTERNS = [
  /\bwarp disruption battery\b/i,
  /\bwarp scrambling battery\b/i,
  /\bstasis webification battery\b/i,
  /\benergy neutralizing battery\b/i,
  /\bsensor dampening battery\b/i,
];
const STACKING_PENALTY_COEFFICIENT = 0.140274;
const FUEL_PER_HOUR_BY_SIZE = {
  small: 10,
  medium: 20,
  large: 40,
};
const SOV_BONUS_OPTIONS = [
  { id: "none", label: "No Sov", fuelMultiplier: 1, issue: "No sovereignty bonus." },
  { id: "alliance", label: "Alliance / Corp Sov", fuelMultiplier: 0.75, issue: "Alliance or corporation sovereignty: -25% fuel." },
];
const SOV_BONUS_BY_ID = Object.fromEntries(SOV_BONUS_OPTIONS.map((option) => [option.id, option]));

const TOWER_SIZE_ORDER = { small: 0, medium: 1, large: 2 };
const DATA_PATHS = {
  towers: "./public/data/towers.json",
  modules: "./public/data/modules.json",
};

const DESCRIPTION_MISSING_TEXT = "No description available.";
const DESCRIPTION_LOADING_TEXT = DESCRIPTION_MISSING_TEXT;
const STATUS_POPUP_ID = "pos-status-popover";

let statusPopup = null;

let TOWER_DATA = [];
let MODULE_DATA = [];
let towerLookup = {};
let moduleLookup = {};

const state = {
  name: "My Control Tower Fit",
  towerId: "",
  sovBonus: "none",
  activeModuleGroup: "production",
  moduleSearch: "",
  modules: {},
};

const dom = {
  fitName: document.getElementById("fit-name"),
  towerSelect: document.getElementById("tower-select"),
  moduleLibrary: document.getElementById("module-library"),
  selectedModules: document.getElementById("selected-modules"),
  towerMeta: document.getElementById("tower-meta"),
  resourceMeta: document.getElementById("resource-meta"),
  fuelMeta: document.getElementById("fuel-meta"),
  sovSelect: document.getElementById("sov-bonus"),
  shieldEhp: document.getElementById("shield-ehp"),
  armorEhp: document.getElementById("armor-ehp"),
  hullEhp: document.getElementById("hull-ehp"),
  totalEhp: document.getElementById("total-ehp"),
  shieldRes: document.getElementById("shield-resist"),
  armorRes: document.getElementById("armor-resist"),
  hullRes: document.getElementById("hull-resist"),
  capacityWarning: document.getElementById("capacity-warning"),
  damageGrid: document.getElementById("damage-grid"),
  shareUrl: document.getElementById("share-url"),
  fitOutput: document.getElementById("fit-output"),
};

function parseNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toResistMap(source) {
  return {
    em: parseNumber(source?.em),
    thermal: parseNumber(source?.thermal),
    kinetic: parseNumber(source?.kinetic),
    explosive: parseNumber(source?.explosive),
  };
}

function normalizeGroup(rawGroup) {
  const normalized = String(rawGroup || "services").toLowerCase();
  if (normalized === "defense") return "defence";
  if (normalized === "service") return "services";
  if (["production", "defence", "services"].includes(normalized)) return normalized;
  return "services";
}

function normalizeSovBonus(raw) {
  const normalized = String(raw || "").toLowerCase();
  if (normalized === "1" || normalized === "alliance" || normalized === "corp" || normalized === "corporation") return "alliance";
  if (normalized === "none" || normalized === "0" || normalized === "false" || normalized === "") return "none";
  if (SOV_BONUS_BY_ID[normalized]) return normalized;
  return "none";
}

function getSovFuelMultiplier(raw) {
  const bonus = SOV_BONUS_BY_ID[normalizeSovBonus(raw)];
  return bonus?.fuelMultiplier ?? 1;
}

function parseFuelMultiplier(rawMultiplier, rawReductionPercent) {
  const reduction = normalizePercent(rawReductionPercent);
  const reductionMultiplier = Number.isFinite(reduction) ? Math.max(0, 1 - reduction) : 1;

  const parsed = Number(rawMultiplier);
  if (!Number.isFinite(parsed) || parsed <= 0) return reductionMultiplier;
  let multiplier = parsed <= 1 ? parsed : Math.max(0, 1 - parsed / 100);
  return Math.max(0, multiplier * reductionMultiplier);
}

function isShieldHardenerModule(name) {
  const moduleName = String(name || "").toLowerCase();
  return (
    /\bshield hardener\b/i.test(moduleName)
    || /\bballistic deflection\b/i.test(moduleName)
    || /\bexplosion dampening\b/i.test(moduleName)
    || /\bheat dissipation\b/i.test(moduleName)
    || /\bphoton scattering\b/i.test(moduleName)
  );
}

function isEcmModule(name) {
  const moduleName = String(name || "");
  return ECM_MODULE_PATTERNS.some((pattern) => pattern.test(moduleName));
}

function isEwarModule(name) {
  const moduleName = String(name || "");
  return EWAR_MODULE_PATTERNS.some((pattern) => pattern.test(moduleName));
}

function normalizeTower(raw) {
  const size = String(raw.size || "").toLowerCase();
  const rawFuelPerHour = parseNumber(raw.fuelPerHour);

  return {
    id: String(raw.id),
    name: String(raw.name || "Unknown control tower"),
    faction: String(raw.faction || ""),
    size,
    cpu: parseNumber(raw.cpu),
    powerGrid: parseNumber(raw.power),
    fuelPerHour: rawFuelPerHour > 0 ? rawFuelPerHour : (FUEL_PER_HOUR_BY_SIZE[size] || 0),
    base: {
      shield: { hp: parseNumber(raw.baseShieldHp), resist: toResistMap(raw.shieldResist) },
      armor: { hp: parseNumber(raw.baseArmorHp), resist: toResistMap(raw.armorResist) },
      hull: { hp: parseNumber(raw.baseHullHp), resist: toResistMap(raw.hullResist) },
    },
  };
}

function normalizeModule(raw) {
  const description = String(raw.description || DESCRIPTION_MISSING_TEXT).trim() || DESCRIPTION_MISSING_TEXT;
  const effects = normalizeModuleEffects(raw.effects);
  const typeId = parseNumber(raw.typeId);
  const module = {
    id: String(raw.code),
    name: String(raw.name || "Unknown module"),
    group: isShieldHardenerModule(raw.name)
      ? "shieldHardening"
      : isEcmModule(raw.name)
        ? "ecm"
        : isEwarModule(raw.name)
          ? "ewar"
        : normalizeGroup(raw.group),
    power: parseNumber(raw.power),
    cpu: parseNumber(raw.cpu),
    status: String(raw.status || "active").toLowerCase(),
    statusIssue: String(raw.statusIssue || raw.statusText || raw.notes || "").trim(),
    description,
    effects,
    typeId,
    iconUrl: String(raw.iconUrl || ""),
    fuelMultiplier: parseFuelMultiplier(raw.fuelMultiplier, raw.fuelReduction),
  };

  if (!hasModuleEffect(module)) {
    const inferred = inferHardenerEffects(module);
    if (hasModuleEffect({ effects: inferred })) {
      module.effects = inferred;
    }
  }

  return {
    ...module,
  };
}

function setDataIndex() {
  towerLookup = Object.fromEntries(TOWER_DATA.map((tower) => [tower.id, tower]));
  moduleLookup = Object.fromEntries(MODULE_DATA.map((module) => [module.id, module]));
}

function getDefaultTower() {
  return {
    name: "No tower loaded",
    faction: "",
    cpu: 0,
    powerGrid: 0,
    fuelPerHour: 0,
    base: {
      shield: { hp: 0, resist: { em: 0, thermal: 0, kinetic: 0, explosive: 0 } },
      armor: { hp: 0, resist: { em: 0, thermal: 0, kinetic: 0, explosive: 0 } },
      hull: { hp: 0, resist: { em: 0, thermal: 0, kinetic: 0, explosive: 0 } },
    },
  };
}

function getTower() {
  return towerLookup[state.towerId] || TOWER_DATA[0] || getDefaultTower();
}

function formatTowerDisplayName(tower) {
  const rawName = String(tower?.name || "").trim();
  const faction = String(tower?.faction || "").trim();
  const size = String(tower?.size || "").trim();

  if (!rawName) return "Unknown Control Tower";
  if (/control tower/i.test(rawName)) return rawName;
  if (faction && size) return `${faction} Control Tower ${size.charAt(0).toUpperCase()}${size.slice(1)}`;
  if (faction) return `${faction} Control Tower`;
  return rawName;
}

function initTowerOptions() {
  dom.towerSelect.innerHTML = "";
  const sorted = [...TOWER_DATA].sort((a, b) => {
    const factionDiff = a.faction.localeCompare(b.faction);
    if (factionDiff !== 0) return factionDiff;

    const sizeDiff = (TOWER_SIZE_ORDER[a.size?.toLowerCase()] ?? 99) - (TOWER_SIZE_ORDER[b.size?.toLowerCase()] ?? 99);
    if (sizeDiff !== 0) return sizeDiff;

    return a.name.localeCompare(b.name);
  });

  sorted.forEach((tower) => {
    const option = document.createElement("option");
    option.value = tower.id;
    option.textContent = formatTowerDisplayName(tower);
    dom.towerSelect.append(option);
  });

  if (!state.towerId || !towerLookup[state.towerId]) {
    state.towerId = sorted[0]?.id ?? "";
  }
}

function getQty(moduleId) {
  return state.modules[moduleId] || 0;
}

function setQty(moduleId, qty) {
  const safeQty = Number(qty);
  if (!Number.isFinite(safeQty) || safeQty <= 0) {
    delete state.modules[moduleId];
  } else {
    state.modules[moduleId] = Math.max(0, Math.min(15, Math.floor(safeQty)));
  }
}

function adjustQty(moduleId, delta) {
  setQty(moduleId, getQty(moduleId) + delta);
}

function formatNumber(value) {
  return Math.round(value).toLocaleString("en-US");
}

function toPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatUsagePercent(used, total) {
  if (!Number.isFinite(total) || total <= 0) {
    return "0.0%";
  }
  return toPercent(used / total);
}

function formatResourceLine(label, used, total, unit) {
  return `${label} ${formatNumber(used)}  |  ${formatNumber(total)} ${unit}  |  ${formatUsagePercent(used, total)}`;
}

function clamp01(value) {
  if (value < 0) return 0;
  if (value > 0.99) return 0.99;
  return value;
}

function moduleStatusMeta(status) {
  return MODULE_STATUS_META[status] || MODULE_STATUS_META.active;
}

function getStatusIssue(module) {
  const metadata = moduleStatusMeta(module.status);
  return module.statusIssue && module.statusIssue.length ? module.statusIssue : metadata.issue;
}

function getStatusPopup() {
  if (statusPopup) return statusPopup;
  const popup = document.createElement("div");
  popup.id = STATUS_POPUP_ID;
  popup.className = "status-popover";
  popup.setAttribute("aria-hidden", "true");
  popup.setAttribute("role", "dialog");

  const panel = document.createElement("div");
  panel.className = "status-popover__panel";
  panel.innerHTML = `
    <header class="status-popover__header">
      <h4 class="status-popover__title"></h4>
      <button type="button" class="status-popover__close" data-status-close="true" aria-label="Close issue details">Ã—</button>
    </header>
    <p class="status-popover__body"></p>
  `;

  popup.append(panel);
  document.body.append(popup);
  statusPopup = popup;
  return popup;
}

function hideStatusPopup() {
  if (!statusPopup) return;
  statusPopup.classList.remove("status-popover--open");
  statusPopup.setAttribute("aria-hidden", "true");
}

function showStatusPopup(anchor, module) {
  const popup = getStatusPopup();
  const title = popup.querySelector(".status-popover__title");
  const body = popup.querySelector(".status-popover__body");

  const meta = moduleStatusMeta(module.status);
  title.textContent = `${meta.label} â€” ${module.name}`;
  body.textContent = getStatusIssue(module);

  popup.classList.add("status-popover--open");
  popup.setAttribute("aria-hidden", "false");

  const rect = anchor.getBoundingClientRect();
  popup.style.left = `${Math.max(12, rect.left)}px`;
  popup.style.top = `${Math.max(12, rect.bottom + 10)}px`;

  const overflowX = popup.offsetWidth + rect.left - window.innerWidth;
  if (overflowX > 0) {
    popup.style.left = `${Math.max(12, window.innerWidth - popup.offsetWidth - 12)}px`;
  }

  const overflowY = popup.offsetHeight + rect.bottom - window.innerHeight;
  if (overflowY > 0) {
    popup.style.top = `${Math.max(12, rect.top - popup.offsetHeight - 10)}px`;
  }
}

function groupModules() {
  const grouped = MODULE_TABS.reduce((acc, tab) => {
    acc[tab.id] = [];
    return acc;
  }, {});

  MODULE_DATA.forEach((module) => {
    const group = getModuleTabId(module);
    if (!grouped[group]) grouped[group] = [];
    grouped[group].push(module);
  });

  return grouped;
}

function getModuleTabId(module) {
  const status = String(module?.status || "").toLowerCase();
  if (status === "deprecated") return "deprecated";
  if (status === "deprecated-limited") return "deprecated-limited";
  return module.group || "services";
}

function getModuleDisplayGroup(module) {
  const tabId = getModuleTabId(module);
  return MODULE_GROUP_LABELS[tabId] || MODULE_GROUP_LABELS[module.group] || tabId;
}

function createModuleCard(module) {
  const status = moduleStatusMeta(module.status);
  const card = document.createElement("article");
  card.className = "module-card";

  const header = document.createElement("div");
  header.className = "module-card__header";

  const titleHeading = document.createElement("h4");
  const title = document.createElement("button");
  title.type = "button";
  title.className = "module-title-button";
  title.dataset.id = module.id;
  title.dataset.action = "description";
  title.setAttribute("aria-label", `Show description for ${module.name}`);
  title.textContent = module.name;
  titleHeading.append(title);

  const badge = document.createElement("button");
  badge.type = "button";
  badge.className = `module-status-badge ${status.className}`;
  badge.dataset.id = module.id;
  badge.dataset.action = "status";
  badge.dataset.status = module.status;
  badge.setAttribute("aria-label", `Show status issue for ${module.name}`);
  badge.title = `Module status: ${status.label}`;
  badge.textContent = status.label;

  header.append(titleHeading, badge);

  const group = document.createElement("span");
  group.className = "module-card__group";
  group.textContent = getModuleDisplayGroup(module);

  const body = document.createElement("div");
  body.className = "module-card__body";

  const details = document.createElement("div");
  details.className = "module-card__details";

  const stats = document.createElement("ul");
  stats.className = "module-card__stats";
  const power = document.createElement("li");
  power.textContent = `Power: ${formatNumber(module.power)} MW`;
  const cpu = document.createElement("li");
  cpu.textContent = `CPU: ${formatNumber(module.cpu)} TF`;
  stats.append(power, cpu);

  const controls = document.createElement("div");
  controls.className = "module-controls";
  const minus = document.createElement("button");
  minus.className = "btn";
  minus.type = "button";
  minus.dataset.id = module.id;
  minus.dataset.delta = "-1";
  minus.setAttribute("aria-label", `Decrease ${module.name}`);
  minus.textContent = "-";

  const input = document.createElement("input");
  input.type = "number";
  input.min = "0";
  input.max = "15";
  input.value = String(getQty(module.id));
  input.dataset.id = module.id;

  const plus = document.createElement("button");
  plus.className = "btn";
  plus.type = "button";
  plus.dataset.id = module.id;
  plus.dataset.delta = "1";
  plus.setAttribute("aria-label", `Increase ${module.name}`);
  plus.textContent = "+";

  controls.append(minus, input, plus);
  details.append(stats, controls);

  if (module.iconUrl) {
    body.classList.add("module-card__body--with-media");
    const media = document.createElement("div");
    media.className = "module-card__media";

    const image = document.createElement("img");
    image.className = "module-card__image";
    image.src = module.iconUrl;
    image.alt = module.name;
    image.loading = "lazy";
    image.addEventListener("error", () => {
      media.remove();
    }, { once: true });

    media.append(image);
    body.append(details, media);
    card.append(header, group, body);
    return card;
  }

  body.append(details);
  card.append(header, group, body);
  return card;
}

function renderModuleLibrary() {
  const grouped = groupModules();
  const groupsWithModules = MODULE_TABS.filter((tab) => grouped[tab.id]?.length > 0);
  const searchQuery = String(state.moduleSearch || "").trim().toLowerCase();
  const previousGrid = dom.moduleLibrary.querySelector(".module-card-grid");
  const previousScrollTop = previousGrid instanceof HTMLElement ? previousGrid.scrollTop : 0;

  dom.moduleLibrary.innerHTML = "";

  if (!MODULE_DATA.length || !groupsWithModules.length) {
    const empty = document.createElement("p");
    empty.className = "module-card__group";
    empty.textContent = "No modules loaded.";
    dom.moduleLibrary.append(empty);
    return;
  }

  if (!state.activeModuleGroup || !grouped[state.activeModuleGroup]?.length) {
    state.activeModuleGroup = groupsWithModules[0].id;
  }

  const search = document.createElement("input");
  search.type = "search";
  search.className = "module-library__search";
  search.dataset.role = "module-search";
  search.placeholder = "Search modules";
  search.setAttribute("aria-label", "Search modules");
  search.value = state.moduleSearch;

  const tabs = document.createElement("div");
  tabs.className = "module-tabs";

  groupsWithModules.forEach((tab) => {
    const tabButton = document.createElement("button");
    tabButton.type = "button";
    tabButton.className = `module-tab ${state.activeModuleGroup === tab.id ? "module-tab--active" : ""}`;
    tabButton.dataset.tab = tab.id;
    tabButton.setAttribute("aria-pressed", state.activeModuleGroup === tab.id ? "true" : "false");
    tabButton.textContent = `${tab.label} (${grouped[tab.id].length})`;
    tabs.append(tabButton);
  });

  const grid = document.createElement("div");
  grid.className = "module-card-grid";

  const modulesToShow = [...grouped[state.activeModuleGroup]]
    .filter((module) => {
      if (!searchQuery) return true;
      const haystack = `${module.name} ${module.description} ${getModuleDisplayGroup(module)}`.toLowerCase();
      return haystack.includes(searchQuery);
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  if (!modulesToShow.length) {
    const empty = document.createElement("p");
    empty.className = "module-library__empty";
    empty.textContent = searchQuery ? "No modules match your search." : "No modules loaded.";
    grid.append(empty);
  } else {
    modulesToShow.forEach((module) => {
      grid.append(createModuleCard(module));
    });
  }

  dom.moduleLibrary.append(search, tabs, grid);
  grid.scrollTop = previousScrollTop;
}

function renderSelectedModules() {
  dom.selectedModules.innerHTML = "";
  const chosen = Object.entries(state.modules).filter(([, qty]) => qty > 0);

  if (!chosen.length) {
    const empty = document.createElement("li");
    empty.className = "selected-item";
    empty.textContent = "No modules selected.";
    dom.selectedModules.append(empty);
    return;
  }

  chosen
    .sort(([a], [b]) => {
      const nameA = moduleLookup[a]?.name || a;
      const nameB = moduleLookup[b]?.name || b;
      return nameA.localeCompare(nameB);
    })
    .forEach(([id, qty]) => {
      const module = moduleLookup[id];
      if (!module) return;
      const status = moduleStatusMeta(module.status);
      const row = document.createElement("li");
      row.className = "selected-item";
      row.innerHTML = `
        <span class="selected-item__name">${module.name}</span>
        <span class="selected-item__meta">${getModuleDisplayGroup(module)} Â· ${status.label}</span>
        <span class="selected-item__qty">x${qty}
          <button class="btn" type="button" data-id="${id}" data-action="remove">Remove</button>
        </span>
      `;
      dom.selectedModules.append(row);
    });
}

function mergeResist(baseResists, bonusBuckets) {
  const out = {};
  DAMAGE_TYPES.forEach((type) => {
    let multiplier = 1;
    const bonuses = [...bonusBuckets[type]]
      .map((bonus) => Number(bonus) || 0)
      .filter((bonus) => bonus > 0)
      .sort((a, b) => b - a);

    bonuses.forEach((bonus, index) => {
      const stackingPenalty = Math.exp(-STACKING_PENALTY_COEFFICIENT * index * index);
      const effectiveBonus = clamp01(bonus * stackingPenalty);
      multiplier *= 1 - effectiveBonus;
    });
    out[type] = clamp01(1 - (1 - baseResists[type]) * multiplier);
  });
  return out;
}

function normalizePercent(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  if (parsed > 1) return parsed / 100;
  return parsed;
}

function parseBonusFromDescription(description) {
  const text = String(description || "");
  const match = text.match(/(\d+(?:\.\d+)?)\s*%/);
  if (!match) return null;
  return normalizePercent(match[1]);
}

function hasModuleEffect(moduleLike) {
  const effects = moduleLike?.effects;
  if (!effects || typeof effects !== "object") return false;

  return Object.values(effects).some((value) => {
    if (!value || typeof value !== "object") return false;
    if (!value.resist || typeof value.resist !== "object") return false;
    return Object.values(value.resist).some((bonus) => {
      const parsed = parseFloat(bonus);
      return Number.isFinite(parsed) && parsed > 0;
    });
  });
}

function normalizeModuleEffects(rawEffects) {
  if (!rawEffects || typeof rawEffects !== "object") return {};

  return Object.fromEntries(
    Object.entries(rawEffects).map(([layer, layerEffects]) => [
      layer,
      {
        hp: parseNumber(layerEffects?.hp),
        resist: {
          em: parseNumber(layerEffects?.resist?.em),
          thermal: parseNumber(layerEffects?.resist?.thermal),
          kinetic: parseNumber(layerEffects?.resist?.kinetic),
          explosive: parseNumber(layerEffects?.resist?.explosive),
        },
      },
    ]),
  );
}

function inferHardenerType(moduleName) {
  const normalized = String(moduleName || "").toLowerCase();
  const found = Object.entries(SHIELD_HARDENER_TYPES).find(([key]) => normalized.includes(key));
  return found ? found[1] : "";
}

function inferHardenerEffects(module) {
  const hardenerType = inferHardenerType(module?.name);
  if (!hardenerType) return {};

  const bonus = parseBonusFromDescription(module?.description) ?? SHIELD_HARDENER_TYPE_BONUSES[hardenerType] ?? SHIELD_HARDENER_DEFAULT_BONUS;
  const resist = {
    em: 0,
    thermal: 0,
    kinetic: 0,
    explosive: 0,
  };
  resist[hardenerType] = bonus;

  return {
    shield: { resist },
  };
}

function ensureModuleEffects() {
  MODULE_DATA.forEach((module) => {
    if (hasModuleEffect(module)) return;
    const inferred = inferHardenerEffects(module);
    if (hasModuleEffect({ effects: inferred })) {
      module.effects = inferred;
    }
  });
}

function avg(values) {
  return DAMAGE_TYPES.reduce((acc, type) => acc + values[type], 0) / 4;
}

function calculateTotals() {
  const tower = getTower();
  const layers = {
    shield: {
      hp: tower.base.shield.hp,
      resistBuckets: DAMAGE_TYPES.reduce((acc, type) => ({ ...acc, [type]: [] }), {}),
    },
    armor: {
      hp: tower.base.armor.hp,
      resistBuckets: DAMAGE_TYPES.reduce((acc, type) => ({ ...acc, [type]: [] }), {}),
    },
    hull: {
      hp: tower.base.hull.hp,
      resistBuckets: DAMAGE_TYPES.reduce((acc, type) => ({ ...acc, [type]: [] }), {}),
    },
  };

  const totals = {
    powerUsed: 0,
    cpuUsed: 0,
    fuelPerHour: 0,
    fuelMultiplier: 1,
    modulesCount: 0,
  };

  Object.entries(state.modules).forEach(([moduleId, qty]) => {
    const module = moduleLookup[moduleId];
    if (!module || qty <= 0) return;

    totals.powerUsed += module.power * qty;
    totals.cpuUsed += module.cpu * qty;
    totals.modulesCount += qty;
    if (Number.isFinite(module.fuelMultiplier) && module.fuelMultiplier > 0) {
      totals.fuelMultiplier *= module.fuelMultiplier ** qty;
    }

    Object.entries(module.effects).forEach(([layerName, layerEffects]) => {
      if (!layerEffects) return;
      if (layerEffects.hp) {
        layers[layerName].hp += layerEffects.hp * qty;
      }
      if (layerEffects.resist) {
        DAMAGE_TYPES.forEach((type) => {
          const bonus = Number(layerEffects.resist[type] || 0);
          if (bonus > 0) {
            for (let i = 0; i < qty; i += 1) {
              layers[layerName].resistBuckets[type].push(bonus);
            }
          }
        });
      }
    });
  });

  const shieldResist = mergeResist(tower.base.shield.resist, layers.shield.resistBuckets);
  const armorResist = mergeResist(tower.base.armor.resist, layers.armor.resistBuckets);
  const hullResist = mergeResist(tower.base.hull.resist, layers.hull.resistBuckets);

  const shieldByType = {};
  const armorByType = {};
  const hullByType = {};

  DAMAGE_TYPES.forEach((type) => {
    shieldByType[type] = layers.shield.hp / Math.max(0.01, 1 - shieldResist[type]);
    armorByType[type] = layers.armor.hp / Math.max(0.01, 1 - armorResist[type]);
    hullByType[type] = layers.hull.hp / Math.max(0.01, 1 - hullResist[type]);
  });

  const totalByType = {
    em: shieldByType.em + armorByType.em + hullByType.em,
    thermal: shieldByType.thermal + armorByType.thermal + hullByType.thermal,
    kinetic: shieldByType.kinetic + armorByType.kinetic + hullByType.kinetic,
    explosive: shieldByType.explosive + armorByType.explosive + hullByType.explosive,
  };
  const sovFuelMultiplier = getSovFuelMultiplier(state.sovBonus);
  totals.fuelPerHour = tower.fuelPerHour * totals.fuelMultiplier * sovFuelMultiplier;

  return {
    ...totals,
    shield: {
      resist: shieldResist,
      avgResist: avg(shieldResist),
      avgEhp: avg(shieldByType),
    },
    armor: {
      resist: armorResist,
      avgResist: avg(armorResist),
      avgEhp: avg(armorByType),
    },
    hull: {
      resist: hullResist,
      avgResist: avg(hullResist),
      avgEhp: avg(hullByType),
    },
    totalByType,
    totalBalanced: avg(totalByType),
  };
}

function renderDamageProfile(totalByType) {
  dom.damageGrid.innerHTML = "";
  DAMAGE_TYPES.forEach((type) => {
    const box = document.createElement("div");
    box.className = "damage-box";
    const header = document.createElement("dt");
    header.className = "damage-box__header";
    const icon = document.createElement("img");
    icon.className = "damage-type-icon";
    icon.src = DAMAGE_TYPE_META[type].icon;
    icon.alt = DAMAGE_TYPE_META[type].alt;
    icon.loading = "lazy";
    const label = document.createElement("span");
    label.textContent = DAMAGE_TYPE_META[type].label;
    const value = document.createElement("dd");
    value.textContent = `${formatNumber(totalByType[type])} EHP`;
    header.append(icon, label);
    box.append(header, value);
    dom.damageGrid.append(box);
  });
}

function buildResistSummary(resists) {
  const entries = DAMAGE_TYPES.map((type) => {
    const meta = DAMAGE_TYPE_META[type];
    return `<span class="resist-entry" title="${meta.label}"><img src="${meta.icon}" alt="${meta.alt}" class="damage-type-icon" loading="lazy" /> <span>${toPercent(resists[type])}</span></span>`;
  }).join("");
  return `<span class="resist-summary">${entries}</span>`;
}

function renderFitOutput(totals) {
  const tower = getTower();
  const towerName = formatTowerDisplayName(tower);
  const lines = Object.entries(state.modules)
    .filter(([, qty]) => qty > 0)
    .sort(([a], [b]) => {
      const nameA = moduleLookup[a]?.name || a;
      const nameB = moduleLookup[b]?.name || b;
      return nameA.localeCompare(nameB);
    })
    .map(([id, qty]) => `${qty}x ${moduleLookup[id].name}`);

  dom.fitOutput.value = [
    `[${state.name}]`,
    `Control Tower: ${towerName}`,
    `Resources:\n${formatResourceLine("Powergrid", totals.powerUsed, tower.powerGrid, "MW")}\n${formatResourceLine("CPU", totals.cpuUsed, tower.cpu, "TF")}`,
    `Fuel: ${formatNumber(totals.fuelPerHour)} units/hour`,
    `Balanced EHP: ${formatNumber(totals.totalBalanced)}`,
    "",
    "[Layer EHP]",
    `Shield: ${formatNumber(totals.shield.avgEhp)} (avg resist ${toPercent(totals.shield.avgResist)})`,
    `Armor:  ${formatNumber(totals.armor.avgEhp)}`,
    `Hull:   ${formatNumber(totals.hull.avgEhp)}`,
    "",
    "[Modules]",
    lines.length ? lines.join("\n") : "No modules",
  ].join("\n");
}

function renderStats(totals) {
  const tower = getTower();
  const overCapacity = totals.powerUsed > tower.powerGrid || totals.cpuUsed > tower.cpu;

  dom.towerMeta.textContent = formatTowerDisplayName(tower);
  dom.resourceMeta.textContent = `${formatResourceLine("Powergrid", totals.powerUsed, tower.powerGrid, "MW")}\n${formatResourceLine("CPU", totals.cpuUsed, tower.cpu, "TF")}`;
  dom.fuelMeta.textContent = formatNumber(totals.fuelPerHour);
  if (dom.sovSelect) {
    dom.sovSelect.value = state.sovBonus;
  }

  dom.capacityWarning.textContent = overCapacity ? "Over capacity" : "Balanced fit";
  dom.capacityWarning.className = overCapacity ? "warning-badge warning-bad" : "warning-badge warning-ok";

  dom.shieldEhp.textContent = `${formatNumber(totals.shield.avgEhp)} (${toPercent(totals.shield.avgResist)} avg)`;
  dom.armorEhp.textContent = `${formatNumber(totals.armor.avgEhp)}`;
  dom.hullEhp.textContent = `${formatNumber(totals.hull.avgEhp)}`;
  dom.totalEhp.textContent = formatNumber(totals.totalBalanced);

  dom.shieldRes.innerHTML = buildResistSummary(totals.shield.resist);
  dom.armorRes.innerHTML = buildResistSummary(totals.armor.resist);
  dom.hullRes.innerHTML = buildResistSummary(totals.hull.resist);

  renderDamageProfile(totals.totalByType);
  dom.shareUrl.value = buildShareUrl();
  renderFitOutput(totals);
}

function render() {
  renderModuleLibrary();
  renderSelectedModules();
  const totals = calculateTotals();
  renderStats(totals);

  dom.fitName.value = state.name;
  dom.towerSelect.value = state.towerId;
}

function encodeState(value) {
  const raw = JSON.stringify(value);
  return btoa(unescape(encodeURIComponent(raw)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decodeState(token) {
  const normalized = token.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (token.length % 4)) % 4);
  return JSON.parse(decodeURIComponent(escape(atob(normalized))));
}

function buildShareUrl() {
  const params = new URLSearchParams(window.location.search);
  params.set("fit", encodeState({ n: state.name, t: state.towerId, m: state.modules, sov: state.sovBonus }));
  return `${window.location.origin}${window.location.pathname}?${params.toString()}`;
}

function loadFromURL() {
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get("fit");
  const sovParam = urlParams.get("sov");
  if (sovParam !== null) {
    state.sovBonus = normalizeSovBonus(sovParam);
  }
  if (!token) return;
  try {
    const payload = decodeState(token);
    if (typeof payload.n === "string") state.name = payload.n;
    if (typeof payload.t === "string" && towerLookup[payload.t]) state.towerId = payload.t;
    if (typeof payload.sov === "string") state.sovBonus = normalizeSovBonus(payload.sov);

    const loaded = {};
    if (payload.m && typeof payload.m === "object") {
      Object.entries(payload.m).forEach(([id, qty]) => {
        if (!moduleLookup[id]) return;
        const safeQty = Math.max(0, Math.min(15, Math.floor(Number(qty) || 0)));
        if (safeQty > 0) loaded[id] = safeQty;
      });
    }
    state.modules = loaded;
  } catch {
    // ignore invalid share links
  }
}

function bindEvents() {
  dom.towerSelect.addEventListener("change", () => {
    state.towerId = dom.towerSelect.value;
    render();
  });

  dom.sovSelect?.addEventListener("change", () => {
    state.sovBonus = normalizeSovBonus(dom.sovSelect.value);
    render();
  });

  dom.fitName.addEventListener("input", () => {
    state.name = dom.fitName.value || "My Control Tower Fit";
    render();
  });

  dom.moduleLibrary.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;

    if (target.dataset.tab) {
      state.activeModuleGroup = target.dataset.tab;
      render();
      return;
    }

    if (target.dataset.action === "status") {
      const module = moduleLookup[target.dataset.id];
      if (module) {
        showStatusPopup(target, module);
      }
      return;
    }

    if (target.dataset.action === "description") {
      const module = moduleLookup[target.dataset.id];
      if (module) {
        showDescriptionPopup(target, module);
      }
      return;
    }

    if (!target.dataset.id || !target.dataset.delta) return;
    adjustQty(target.dataset.id, Number(target.dataset.delta));
    render();
  });

  dom.moduleLibrary.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    setQty(target.dataset.id, target.valueAsNumber);
    render();
  });

  dom.moduleLibrary.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.dataset.role !== "module-search") return;
    const selectionStart = target.selectionStart ?? target.value.length;
    const selectionEnd = target.selectionEnd ?? selectionStart;
    state.moduleSearch = target.value || "";
    render();
    const nextSearch = dom.moduleLibrary.querySelector('[data-role="module-search"]');
    if (nextSearch instanceof HTMLInputElement) {
      nextSearch.focus();
      nextSearch.setSelectionRange(
        Math.min(selectionStart, nextSearch.value.length),
        Math.min(selectionEnd, nextSearch.value.length),
      );
    }
  });

  dom.selectedModules.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    if (target.dataset.action !== "remove") return;
    delete state.modules[target.dataset.id];
    render();
  });

  document.addEventListener("click", (event) => {
    if (!statusPopup || !statusPopup.classList.contains("status-popover--open")) return;
    const target = event.target;
    if (!target) return;
    if (target instanceof HTMLButtonElement && target.dataset?.statusClose) {
      hideStatusPopup();
      return;
    }
    if (target instanceof HTMLElement && target.closest(".module-status-badge")) return;
    if (target instanceof HTMLElement && target.closest(".module-title-button")) return;
    if (!(target instanceof HTMLElement)) return;
    if (!statusPopup.contains(target)) {
      hideStatusPopup();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      hideStatusPopup();
    }
  });

  window.addEventListener("scroll", hideStatusPopup, { passive: true });
  window.addEventListener("resize", hideStatusPopup, { passive: true });
}

function displayNoDataState(message) {
  const text = message || "EVE POS data not loaded.";
  dom.towerMeta.textContent = text;
  dom.resourceMeta.textContent = "Powergrid unavailable\nCPU unavailable";
  dom.fuelMeta.textContent = "0";
  state.sovBonus = "none";
  if (dom.sovSelect) {
    dom.sovSelect.value = "none";
  }
  dom.shieldEhp.textContent = "0";
  dom.armorEhp.textContent = "0";
  dom.hullEhp.textContent = "0";
  dom.totalEhp.textContent = "0";
  const zeroResist = buildResistSummary({ em: 0, thermal: 0, kinetic: 0, explosive: 0 });
  dom.shieldRes.innerHTML = zeroResist;
  dom.armorRes.innerHTML = zeroResist;
  dom.hullRes.innerHTML = zeroResist;
  dom.capacityWarning.textContent = text;
  dom.capacityWarning.className = "warning-badge warning-bad";
  dom.damageGrid.innerHTML = "";
  dom.fitOutput.value = text;
}

async function loadGameData() {
  const assignData = (towers, modules) => {
    TOWER_DATA = Array.isArray(towers) ? towers.map(normalizeTower) : [];
    MODULE_DATA = Array.isArray(modules) ? modules.map(normalizeModule) : [];
    ensureModuleEffects();
    setDataIndex();
  };

  try {
    if (Array.isArray(window.__POS_TOWER_DATA__) && Array.isArray(window.__POS_MODULE_DATA__)) {
      assignData(window.__POS_TOWER_DATA__, window.__POS_MODULE_DATA__);
      return;
    }

    if (window.location.protocol === "file:") {
      throw new Error("file:// detected with no embedded data");
    }

    const [towerResponse, moduleResponse] = await Promise.all([fetch(DATA_PATHS.towers), fetch(DATA_PATHS.modules)]);
    if (!towerResponse.ok) throw new Error(`Failed to load towers: ${towerResponse.status}`);
    if (!moduleResponse.ok) throw new Error(`Failed to load modules: ${moduleResponse.status}`);
    const [towerPayload, modulePayload] = await Promise.all([towerResponse.json(), moduleResponse.json()]);
    assignData(towerPayload, modulePayload);
  } catch (error) {
    console.error(error);
    TOWER_DATA = [];
    MODULE_DATA = [];
    towerLookup = {};
    moduleLookup = {};
  }
}

async function init() {
  await loadGameData();
  if (!TOWER_DATA.length || !MODULE_DATA.length) {
    displayNoDataState("Data load failed. Please check your local data files.");
    return;
  }

  initTowerOptions();
  bindEvents();
  loadFromURL();
  ensureModuleEffects();
  render();
}

function getOrCreateStatusPopup() {
  if (statusPopup) return statusPopup;

  const popup = document.createElement("div");
  popup.id = STATUS_POPUP_ID;
  popup.className = "status-popover";
  popup.setAttribute("aria-hidden", "true");
  popup.setAttribute("role", "dialog");

  const panel = document.createElement("div");
  panel.className = "status-popover__panel";

  const header = document.createElement("header");
  header.className = "status-popover__header";

  const title = document.createElement("h4");
  title.className = "status-popover__title";

  const close = document.createElement("button");
  close.type = "button";
  close.className = "status-popover__close";
  close.dataset.statusClose = "true";
  close.setAttribute("aria-label", "Close issue details");
  close.textContent = "x";

  const body = document.createElement("p");
  body.className = "status-popover__body";

  header.append(title, close);
  panel.append(header, body);
  popup.append(panel);
  document.body.append(popup);

  statusPopup = popup;
  return popup;
}

function openStatusPopup(anchor, titleText, bodyText) {
  const popup = getOrCreateStatusPopup();
  const title = popup.querySelector(".status-popover__title");
  const body = popup.querySelector(".status-popover__body");

  if (title) title.textContent = titleText;
  if (body) body.textContent = bodyText;

  popup.classList.add("status-popover--open");
  popup.setAttribute("aria-hidden", "false");

  const rect = anchor.getBoundingClientRect();
  popup.style.left = `${Math.max(12, rect.left)}px`;
  popup.style.top = `${Math.max(12, rect.bottom + 10)}px`;

  const overflowX = popup.offsetWidth + rect.left - window.innerWidth;
  if (overflowX > 0) {
    popup.style.left = `${Math.max(12, window.innerWidth - popup.offsetWidth - 12)}px`;
  }

  const overflowY = popup.offsetHeight + rect.bottom - window.innerHeight;
  if (overflowY > 0) {
    popup.style.top = `${Math.max(12, rect.top - popup.offsetHeight - 10)}px`;
  }
}

function showStatusPopup(anchor, module) {
  const meta = moduleStatusMeta(module.status);
  openStatusPopup(anchor, `${meta.label} - ${module.name}`, getStatusIssue(module));
}

function showDescriptionPopup(anchor, module) {
  openStatusPopup(anchor, module.name, module.description || DESCRIPTION_LOADING_TEXT);
}

function hideStatusPopup() {
  if (!statusPopup) return;
  statusPopup.classList.remove("status-popover--open");
  statusPopup.setAttribute("aria-hidden", "true");
}

init();


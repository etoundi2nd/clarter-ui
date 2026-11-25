// The colours of the layout's Figma design, by their Figma variable names.
export const C = {
    bgApp: "#17191b",
    bgSidebar: "#17191b",
    bgTerminal: "#22262b",
    bgRowSelected: "#2d3034",
    bgRowHover: "#2d303480",
    bgSessionToggle: "#3b3f44",
    bgTabActive: "#36393d",
    bgServerControl: "#272c31",
    bgPlanBadge: "#20252b",
    bgProgressTrack: "#292e34",
    borderSubtle: "#303236",
    borderSection: "#303438",
    borderPane: "#363a3f",
    borderTabActive: "#4a4e53",
    borderServerControl: "#3a4149",
    borderFocused: "#82b7ed",
    textPrimary: "#dddfe2",
    textSecondary: "#adb0b4",
    textTertiary: "#7c7f82",
    textMuted: "#9198a1",
    textMutedLegacy: "#969ba2",
    textAppName: "#dcdde0",
    textTab: "#e6e7e9",
    textPaneTitle: "#e3e4e6",
    textOnEmphasis: "#ffffff",
    textSessionUsage: "#77be8f",
    textPlan: "#5b8fee",
    statusBehind: "#d7747d",
    statusIdle: "#777e86",
    statusAttention: "#dcab6c",
    statusWarning: "#d29922",
    statusSuccess: "#3fb950",
    statusError: "#f85149",
    accent: "#6ba9e9",
    spaceProjectBadge: "#51a99b",
    spaceGeneralBadge: "#464b52",
    fgOpen: "#3fb950",
    fgDone: "#ab7df8",
    fgClosed: "#f85149",
    fgAttention: "#d29922",
};

// Over9k's launcher (github.com/herunan/herdr-over9k) when it's installed, else Herdr's own menu.
export const LAUNCHER = { mod: "new-menu", kind: "popup", width: 250, height: 512 };
export function findLauncher(exec, appHome) {
    exec("test", ["-f", `${appHome()}/mods/over9k-new-menu/mod.json`])
        .then((r) => { if (r?.code === 0) Object.assign(LAUNCHER, { mod: "over9k-new-menu", width: 340, height: 640 }); })
        .catch(() => {});
}

export const ICON = (name) => `mods/clarter-ui/icons/${name}.svg`;

// Inter's "normal" line height at 12–13 px is about 1.2 em, what Figma's auto lines use.
export const AUTO = (size) => `${Math.round(size * 1.21)}px`;

export const stop = (_e, cx) => cx.stop_propagation();

// "1h22m", "46m", "2d".
export function duration(seconds) {
    const m = Math.max(0, Math.floor(seconds / 60));
    if (m < 60) return `${m}m`;
    if (m < 1440) return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m`;
    return `${Math.floor(m / 1440)}d`;
}

// "12m", "6h", "2d" since an ISO time.
export function age(iso) {
    const s = (Date.now() - Date.parse(iso)) / 1000;
    if (!(s >= 0)) return "";
    return s < 3600 ? `${Math.max(1, Math.floor(s / 60))}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
}

// The layout's own settings (the sidebar's "Layout settings"), kept in shared "clarter-ui.settings".
export const SETTINGS_DEFAULTS = { aiCommands: ["claude"], aiCommand: "claude", reviewPrompt: "Review pull request {url}" };
export function layoutSettings(shared) {
    const s = { ...SETTINGS_DEFAULTS, ...(shared("clarter-ui.settings") ?? {}) };
    if (!s.aiCommands.includes(s.aiCommand)) s.aiCommand = s.aiCommands[0] ?? null;
    return s;
}

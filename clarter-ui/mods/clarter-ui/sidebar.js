// The left sidebar: Spaces and their agents in one list (the Over9k idea), with the
// window's brand row above and Settings / Add machine below.
import { div, image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import {
    spaces, panes, agents, terminals, focused, setAgentOrder, run, openOverlay, exec, appHome, readTextFile,
    layout, window, shared, setShared, checking, updates, notify, home,
} from "herdr";
import { C, ICON, AUTO, stop, duration, LAUNCHER, findLauncher } from "./tokens.js";
import { prStatusChip } from "./github.js";
import { agentTask, codexTitle, isCodex, clean } from "./agent-name.js";

const NEW_CLI = "Terminal";
const STATUS_DOT = { blocked: C.statusAttention, done: C.accent, idle: C.statusIdle, working: C.statusIdle };

function find(node, id) {
    if (node?.id === id) return node;
    for (const child of node?.children ?? []) {
        const found = find(child, id);
        if (found) return found;
    }
    return null;
}

const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

function toggleSidebar() {
    const width = find(layout(), "sidebar")?.size?.px;
    if (!narrow()) setShared("clarter-ui.sidebarWidth", width);
    run("layout.resize", { id: "sidebar", px: narrow() ? (shared("clarter-ui.sidebarWidth") ?? 311) : window()?.platform === "macos" ? 76 : 44 });
}

// A 12px icon at (left, top) of the design, inside a larger hit area that lights up on hover.
function iconButton(id, icon, size, hit, action, tip) {
    const pad = (hit - size) / 2;
    return div().id(id).size(hit).rounded(5).cursor_pointer().relative().flex_none()
        .hover((s) => s.bg(C.bgRowSelected))
        .on_mouse_down("left", stop)
        .on_click((e, cx) => { cx.stop_propagation(); action(e, cx); })
        .when(Boolean(tip), (el) => el.tooltip(tip))
        .child(image(ICON(icon)).size(size).absolute().left(pad).top(pad));
}

const python = (args) => exec("python3", args).catch(() => null);
const initial = (name) => ((name ?? "").match(/[\p{L}\p{N}]/u)?.[0] ?? "?").toUpperCase();
const json = (r) => { try { return r?.code === 0 ? JSON.parse(r.stdout || "null") : null; } catch { return null; } };

export class Brand {
    render() {
        const collapsed = narrow(), mac = window()?.platform === "macos";
        const root = div().size_full().relative().bg(C.bgSidebar);
        if (collapsed) return mac ? root : root.child(iconButton("sidebar-toggle", "sidebar", 12, 24, toggleSidebar, "Show sidebar").absolute().left(10).top(12));
        return root
            .child(image("frame/welcome/herdr.png").size(16).rounded(4).absolute().left(78).top(15))
            .child(div().absolute().left(104).top(15).h(16).text_size(13).line_height("16px").font_weight(500).text_color(C.textAppName).child("Herdr"))
            .child(iconButton("search", "search", 12, 24, () => run("mod.open", { name: "picker" }), "Search").absolute().right(41).top(12))
            .child(iconButton("sidebar-toggle", "sidebar", 12, 24, toggleSidebar, "Hide sidebar").absolute().right(11).top(12));
    }
}

export class Footer {
    row(id, icon, size, iconLeft, label, color, action) {
        return div().id(id).absolute().left(8).right(8).h(28).rounded(6).cursor_pointer()
            .hover((s) => s.bg(C.bgRowSelected))
            .on_click(action)
            .child(image(ICON(icon)).size(size).absolute().left(iconLeft).top((28 - size) / 2 + 1))
            .child(div().absolute().left(31).top(6).text_size(13).line_height(AUTO(13)).text_color(color).child(label));
    }

    render() {
        if (narrow()) return v_flex().size_full().bg(C.bgSidebar).border_t(1).border_color(C.borderSubtle).items_center().pt(6).gap(4)
            .child(iconButton("settings", "settings", 14, 28, () => run("app.settings"), "Settings"))
            .child(iconButton("machine", "plus", 12, 28, () => run("mod.open", { name: "machine-add" }), "Add machine"));
        const ready = Boolean(updates()?.app?.ready);
        return div().size_full().relative().bg(C.bgSidebar).border_t(1).border_color(C.borderSubtle)
            .child(this.row("settings", "settings", 14, 8, "Settings", C.textSecondary, () => run("app.settings")).top(5)
                .when(ready, (el) => el.child(div().size(6).rounded(3).bg(C.accent).absolute().left(92).top(11))))
            .child(this.row("machine", "plus", 12, 9, "Add machine", C.textTertiary, () => run("mod.open", { name: "machine-add" })).top(33));
    }
}

export class Spaces {
    init(cx) {
        this.info = {};
        this.prs = {};
        this.repos = {};
        this.accounts = { terminals: {}, accounts: [] };
        this.hover = null;
        try { this.collapsed = new Set(JSON.parse(localStorage.getItem("clarter-ui.collapsedSpaces") ?? "[]")); } catch { this.collapsed = new Set(); }
        try { this.closedSubs = new Set(JSON.parse(localStorage.getItem("clarter-ui.closedSubs") ?? "[]")); } catch { this.closedSubs = new Set(); }
        // The Spaces header's + opens a terminal here: ~/development when there is one, else home.
        this.newSpace = { folder: home(), name: "home" };
        if (checking()) return;
        findLauncher(exec, appHome);
        exec("test", ["-d", `${home()}/development`]).then((r) => { if (r?.code === 0) this.newSpace = { folder: `${home()}/development`, name: "development" }; }).catch(() => {});
        cx.timer.every(10000, (cx) => { this.loadInfo(cx); this.arrange(cx); if (!Object.keys(this.repos).length) this.loadRepos(cx); });
        cx.timer.every(30000, (cx) => this.loadPrs(cx));
        cx.timer.every(60000, (cx) => this.loadRepos(cx));
        this.loadInfo(cx);
        this.loadRepos(cx);
    }

    // Model, effort, context and last reply of each Claude Code agent here: Over9k's reader.
    loadInfo(cx) {
        if (this.infoBusy || window()?.visible === false) return;
        this.infoBusy = true;
        cx.spawn(async (cx) => {
            try {
                this.script ??= await readTextFile(`${appHome()}/mods/clarter-ui/claude-info.py`).catch(() => null);
                const info = this.script ? json(await python(["-c", this.script])) ?? {} : {};
                const accounts = json(await python(["-I", `${appHome()}/mods/clarter-ui/accounts.py`]));
                if (accounts && JSON.stringify(accounts.terminals) !== JSON.stringify(this.accounts.terminals)) { this.accounts = accounts; cx.notify(); }
                if (JSON.stringify(info) !== JSON.stringify(this.info)) {
                    const first = !Object.keys(this.info).length;
                    this.info = info;
                    setShared("clarter-ui.info", info);
                    if (first) this.loadPrs(cx);
                    cx.notify();
                }
            } finally { this.infoBusy = false; }
        });
    }

    // A folder has one space: a tab goes to the space of the folder its terminals all sit in,
    // else to the first space opened on its own space's folder (a ⏰ task space last).
    arrange(cx) {
        if (this.arranging) return;
        const norm = (f) => (f ?? "").replace(/\/+$/, "");
        const list = spaces().filter((s) => !s.machine);
        const home = {};
        for (const s of [...list.filter((s) => !s.name.startsWith("⏰")), ...list]) home[norm(s.folder)] ??= s;
        const all = panes();
        const moves = [];
        for (const s of list) for (const tab of s.tabs) {
            const cwds = all.filter((p) => p.tab === tab.id && p.terminal).map((p) => norm(p.cwd));
            const same = cwds.length > 0 && cwds.every((c) => c && c === cwds[0]);
            const target = (same && home[cwds[0]]) || home[norm(s.folder)];
            if (!target || target.id === s.id) continue;
            moves.push({ tab: tab.id, to: target.id });
        }
        if (!moves.length) return;
        const focusedPane = focused()?.pane;
        const follow = moves.find((m) => all.some((p) => p.tab === m.tab && p.pane === focusedPane));
        this.arranging = true;
        cx.spawn(async () => {
            try {
                const r = json(await python(["-I", `${appHome()}/mods/clarter-ui/arrange.py`, JSON.stringify(moves)]));
                if (!r?.moved) return;
                if (follow) { run("space.select", { id: follow.to }); run("pane.focus", { pane: focusedPane }); }
            } finally { this.arranging = false; }
        });
    }

    // Each session's main pull request (Over9k's pr-info.py finds it in the transcript),
    // then its review, CI and conflict state (github.py).
    loadPrs(cx) {
        const paths = [...new Set(Object.values(this.info).map((i) => i?.transcript).filter(Boolean))];
        if (this.prBusy || !paths.length || window()?.visible === false) return;
        this.prBusy = true;
        cx.spawn(async (cx) => {
            try {
                const found = json(await python(["-I", `${appHome()}/mods/clarter-ui/pr-info.py`, ...paths])) ?? {};
                const keyOf = {};
                for (const [transcript, rows] of Object.entries(found)) if (rows?.[0]) keyOf[transcript] = `${rows[0].repo}#${rows[0].number}`;
                const keys = [...new Set(Object.values(keyOf))];
                const details = keys.length ? json(await python(["-I", `${appHome()}/mods/clarter-ui/github.py`, "prs", ...keys])) ?? {} : {};
                const prs = Object.fromEntries(Object.entries(keyOf).map(([t, k]) => [t, details[k]]).filter(([, d]) => d));
                if (JSON.stringify(prs) !== JSON.stringify(this.prs)) { this.prs = prs; cx.notify(); }
            } finally { this.prBusy = false; }
        });
    }

    loadRepos(cx) {
        const folders = [...new Set(spaces().filter((s) => !s.machine && s.folder).map((s) => s.folder))];
        if (this.repoBusy || !folders.length) return;
        this.repoBusy = true;
        cx.spawn(async (cx) => {
            try {
                const repos = json(await python(["-I", `${appHome()}/mods/clarter-ui/github.py`, "repo", ...folders])) ?? {};
                const open = {};
                for (const r of Object.values(repos)) {
                    if (!r.slug || r.slug in open) continue;
                    const list = json(await python(["-I", `${appHome()}/mods/clarter-ui/github.py`, "involved", r.root]));
                    open[r.slug] = list?.prs?.length ?? 0;
                }
                for (const r of Object.values(repos)) if (r.slug) r.open = open[r.slug];
                if (JSON.stringify(repos) !== JSON.stringify(this.repos)) { this.repos = repos; cx.notify(); }
            } finally { this.repoBusy = false; }
        });
    }

    // Fast-forward only: a pull that would merge or hit local changes is refused and reported.
    pull(repo, cx) {
        if (this.pulling) return;
        this.pulling = repo.root;
        cx.notify();
        cx.spawn(async (cx) => {
            const r = json(await python(["-I", `${appHome()}/mods/clarter-ui/github.py`, "pull", repo.root]));
            this.pulling = null;
            notify(r?.ok
                ? { title: `Pulled ${repo.slug ?? repo.root}`, body: r.output, level: "success", timeout: 4000 }
                : { title: `Could not pull ${repo.slug ?? repo.root}`, body: r?.output ?? "git pull failed", level: "error", timeout: 8000 });
            this.repoBusy = false;
            this.loadRepos(cx);
            cx.notify();
        });
    }

    goTo(p) {
        const sp = spaces().find((s) => s.tabs.some((t) => t.id === p.tab));
        if (sp && !sp.active) run("space.select", { id: sp.id });
        run("tab.select", { id: p.tab });
        run("pane.focus", { pane: p.pane });
    }

    toggleSpace(id) {
        this.collapsed.has(id) ? this.collapsed.delete(id) : this.collapsed.add(id);
        localStorage.setItem("clarter-ui.collapsedSpaces", JSON.stringify([...this.collapsed]));
    }

    toggleSubs(address) {
        this.closedSubs.has(address) ? this.closedSubs.delete(address) : this.closedSubs.add(address);
        localStorage.setItem("clarter-ui.closedSubs", JSON.stringify([...this.closedSubs]));
    }

    // "Opus 5.5 • high • 16% • 1h22m": model, effort, context used (green), time.
    meta(a, info, tab) {
        const codex = a && isCodex(a) ? codexTitle(a.title) : null;
        const model = info?.model ?? codex?.model ?? (a?.program?.agent && !info ? a.program.name : null);
        const effort = info?.effort ?? codex?.effort ?? null;
        const context = info?.context ?? codex?.context ?? null;
        const since = a?.status === "working" && tab?.working_since
            ? (Date.now() - (tab.working_since < 1e12 ? tab.working_since * 1000 : tab.working_since)) / 1000
            : info?.lastAt ? Date.now() / 1000 - info.lastAt : null;
        const lead = [model, effort].filter(Boolean).map((x) => `${x} • `).join("");
        const time = since != null ? duration(since) : null;
        // Which account, once this computer has more than one Claude account to tell apart.
        const dir = a && this.accounts.terminals[a.address];
        const user = dir && this.accounts.accounts.length > 1 ? this.accounts.accounts.find((x) => x.dir === dir)?.displayName : null;
        if (!lead && context == null && !time) return null;
        return h_flex().w_full().min_w(0).h(12).flex_none().overflow_hidden().text_size(10).line_height("12px").text_color(C.textMutedLegacy)
            .when(Boolean(lead), (el) => el.child(div().flex_none().child(lead.replace(/ $/, " "))))
            .when(context != null, (el) => el.child(div().flex_none().text_color(C.textSessionUsage).child(`${Math.round(context)}% `)))
            .when(Boolean(time), (el) => el.child(div().flex_none().child(context != null ? `• ${time}` : time)))
            .when(Boolean(user), (el) => el.child(div().flex_1().min_w(0).truncate().child(` • ${user}`)));
    }

    // While the row is hovered the status turns into its close button.
    statusMark(status, top, id, onClose) {
        if (onClose && this.hoverRow === id) return div().id(`close-${id}`).size(16).absolute().left(6).top(top - 5).rounded(4).cursor_pointer()
            .hover((s) => s.bg(C.bgSessionToggle))
            .tooltip("Close pane")
            .on_mouse_down("left", stop)
            .on_click((_e, cx) => { cx.stop_propagation(); this.hoverRow = null; onClose(); })
            .child(image(ICON("close")).size(10).absolute().left(3).top(3));
        if (status === "working") return svg(ICON("spinner")).size(12).text_color(C.textMutedLegacy).spin(900).absolute().left(8).top(top - 3);
        return div().size(6).rounded(3).bg(STATUS_DOT[status] ?? C.statusIdle).absolute().left(11).top(top)
            .when(status === "idle", (el) => el.opacity(0.25));
    }

    subToggle(address, count) {
        const open = !this.closedSubs.has(address);
        return div().id(`subs-${address}`).w(21).h(16).flex_none().rounded(5).bg(C.bgSessionToggle).relative().cursor_pointer()
            .tooltip(`${count} sub-${count === 1 ? "session" : "sessions"}: ${open ? "hide" : "show"}`)
            .on_mouse_down("left", stop)
            .on_click((_e, cx) => { cx.stop_propagation(); this.toggleSubs(address); cx.notify(); })
            .child(div().absolute().left(3).top(2).text_size(10).line_height("12px").text_color(C.textMutedLegacy).child(String(count)))
            .child(open ? image(ICON("chevron-down")).size(8).absolute().left(10).top(4)
                : svg("mods/workspace-chrome/chevron-right.svg").size(8).text_color(C.textMutedLegacy).absolute().left(10).top(4));
    }

    // One session: 36px with its details line, 24px without.
    row({ id, title, status, selected, terminal, metaEl, actions, onClick, onRight, onClose }) {
        const plain = !metaEl;
        const h = plain ? 24 : 36;
        return div().id(id).w_full().h(h).flex_none().relative().rounded(6).cursor_pointer()
            .when(selected, (el) => el.bg(C.bgRowSelected))
            .when(!selected, (el) => el.hover((s) => s.bg(C.bgRowHover)))
            .on_hover((on, cx) => { if (on) this.hoverRow = id; else if (this.hoverRow === id) this.hoverRow = null; cx.notify(); })
            .on_click(onClick)
            .when(Boolean(onRight), (el) => el.on_mouse_down("right", onRight))
            .child(this.statusMark(status, plain ? 9 : 8, id, onClose))
            .when(terminal, (el) => el.child(image(ICON("terminal")).size(12).absolute().left(25).top(6)))
            // In flow, not absolute: the title gives way and the actions stay inside the row,
            // flush right, growing leftwards.
            .child(v_flex().size_full().min_w(0).pl(terminal ? 37 : 25).pr(10).pt(plain ? 5 : 4)
                .child(h_flex().w_full().min_w(0).h(14).gap(4).items_start()
                    .child(div().flex_1().min_w(0).overflow_hidden().truncate().text_size(12).line_height("14px")
                        .when(selected, (el) => el.font_weight(500)).text_color(C.textPrimary)
                        .when(status === "idle", (el) => el.opacity(0.75)).child(title))
                    .when(actions.length > 0, (el) => el.child(h_flex().flex_none().h(16).gap(4).items_center().justify_end().children(actions))))
                .when(Boolean(metaEl), (el) => el.child(metaEl)));
    }

    paneRow(p, tab, focusedPane) {
        const a = agents().find((x) => x.address === p.terminal);
        const info = a ? this.info[a.address] : null;
        const pr = info?.transcript ? this.prs[info.transcript] : null;
        const subs = a ? terminals().filter((k) => k.parent === a.address && k.state === "live") : [];
        const actions = [
            pr && prStatusChip(`pr-${p.pane}`, pr, (url) => exec("open", [url])),
            subs.length > 0 && this.subToggle(a.address, subs.length),
        ].filter(Boolean);
        const prog = p.program;
        const unnamed = prog?.agent ? prog.name : !prog || prog.shell ? NEW_CLI : clean(p.title) || prog.name;
        const title = p.name || (a ? agentTask(a, p.cwd) || a.program?.name : null) || (tab.named ? tab.name : null) || unnamed || NEW_CLI;
        const metaEl = a ? this.meta(a, info, tab) : null;
        const row = this.row({
            id: `row-${p.pane}`, title, status: a?.status ?? p.status ?? "idle", selected: p.pane === focusedPane,
            terminal: !a, metaEl, actions,
            onClick: () => this.goTo(p),
            onClose: () => run("pane.close", { pane: p.pane }),
            onRight: (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", props: { tab: "pane", target: { pane: p.pane, terminal: p.terminal } } }); },
        });
        if (!subs.length || this.closedSubs.has(a.address)) return [row];
        return [row, v_flex().w_full().pl(18).children(subs.map((k) => this.row({
            id: `sub-${k.address}`,
            title: clean(k.name) || clean(k.title) || k.program?.name || k.address,
            status: k.status ?? "idle", selected: false, terminal: false,
            metaEl: this.meta({ ...k, program: k.program ?? {}, title: k.title ?? "" }, this.info[k.address], null),
            actions: [],
            onClick: () => run("terminal.peek", { terminal: k.address }),
            onClose: () => run("terminal.kill", { terminal: k.address }),
        })))];
    }

    spaceHeader(s) {
        const repo = this.repos[s.folder];
        const project = Boolean(repo?.root);
        const open = (url) => exec("open", [url]);
        const chips = [
            repo?.url && div().id(`gh-${s.id}`).w(22).h(20).flex_none().rounded(5).relative().cursor_pointer().hover((el) => el.bg(C.bgRowSelected))
                .tooltip(`Open ${repo.slug} on GitHub`).on_mouse_down("left", stop)
                .on_click((_e, cx) => { cx.stop_propagation(); open(repo.url); })
                .child(image(ICON("github")).size(12).absolute().left(5).top(4)),
            repo?.behind > 0 && h_flex().id(`behind-${s.id}`).h(20).pl(5).pr(5).flex_none().items_center().rounded(5).cursor_pointer()
                .hover((el) => el.bg(C.bgRowSelected))
                .when(this.pulling === repo.root, (el) => el.opacity(0.5))
                .tooltip(this.pulling === repo.root ? "Pulling\u2026" : `${repo.behind} ${repo.behind === 1 ? "commit" : "commits"} behind upstream: click to pull`)
                .on_mouse_down("left", stop)
                .on_click((_e, cx) => { cx.stop_propagation(); this.pull(repo, cx); })
                .child(image(ICON("arrow-down")).size(10).flex_none())
                .child(div().text_size(11).line_height("13px").text_color(C.statusBehind).child(String(repo.behind))),
            repo?.open > 0 && h_flex().id(`prs-${s.id}`).h(20).pl(10).pr(1).flex_none().items_center().rounded(5).cursor_pointer()
                .hover((el) => el.bg(C.bgRowSelected))
                .tooltip(`${repo.open} open pull ${repo.open === 1 ? "request" : "requests"} involving you`)
                .on_mouse_down("left", stop)
                .on_click((_e, cx) => { cx.stop_propagation(); open(`${repo.url}/pulls?q=is%3Apr+is%3Aopen+involves%3A%40me`); })
                .child(image(ICON("pr-open-11")).size(11).flex_none())
                .child(div().text_size(11).line_height("13px").text_color(C.textMutedLegacy).child(String(repo.open))),
        ].filter(Boolean);
        return div().id(`space-${s.id}`).w_full().h(32).flex_none().relative().cursor_pointer()
            .on_click(() => { if (!s.active) run("space.select", { id: s.id }); })
            .on_hover((on, cx) => { this.hover = on ? s.id : this.hover === s.id ? null : this.hover; cx.notify(); })
            .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", props: { tab: "space", target: { id: s.id } } }); })
            // The triangle's glyph is centred on x 8 of 16: at left 6 it lines up with the rows' status dots.
            .child(div().id(`fold-${s.id}`).size(16).absolute().left(6).top(8).rounded(4).cursor_pointer()
                .hover((el) => el.bg(C.bgRowSelected))
                .tooltip(this.collapsed.has(s.id) ? "Show sessions" : "Hide sessions")
                .on_mouse_down("left", stop)
                .on_click((_e, cx) => { cx.stop_propagation(); this.toggleSpace(s.id); cx.notify(); })
                .child(svg(ICON(this.collapsed.has(s.id) ? "triangle-right" : "triangle-down")).size(16).text_color(C.textMutedLegacy)))
            .child(h_flex().absolute().left(25).right(20).top(6).h(20).items_center()
                .child(div().flex_shrink(1).min_w(0).truncate().mr(6).text_size(12).line_height("16px").font_weight(500).text_color(C.textPrimary).child(s.name))
                .children(chips))
            .when(this.hover === s.id, (el) => el.child(div().id(`add-${s.id}`).absolute().right(0).top(8).size(16).rounded(4).cursor_pointer().hover((el) => el.bg(C.bgRowSelected))
                .tooltip("New tab or agent in this space")
                .on_mouse_down("left", stop)
                .on_click((_e, cx) => { cx.stop_propagation(); if (!s.active) run("space.select", { id: s.id }); openOverlay(LAUNCHER); })
                .child(image(ICON("plus")).size(12).absolute().left(2).top(2))));
    }

    rail(list) {
        return v_flex().size_full().bg(C.bgSidebar).items_center().pt(8).gap(6).children(list.map((s) => {
            const project = Boolean(this.repos[s.folder]?.root);
            return h_flex().id(`rail-${s.id}`).size(24).rounded(6).justify_center().items_center().cursor_pointer()
                .when(s.active, (el) => el.bg(C.bgRowSelected)).tooltip(s.name)
                .on_click(() => run("space.select", { id: s.id }))
                .child(h_flex().size(18).rounded(5).justify_center().items_center().bg(project ? C.spaceProjectBadge : C.spaceGeneralBadge)
                    .child(div().text_size(12).font_weight(500).text_color(C.textOnEmphasis).child(initial(s.name))));
        }));
    }

    render() {
        const list = spaces();
        const focusedPane = focused()?.pane;
        const all = panes();
        const order = [];
        const blocks = list.map((s) => {
            const rows = [];
            for (const tab of s.tabs) for (const p of all.filter((x) => x.tab === tab.id && x.terminal)) {
                if (agents().some((a) => a.address === p.terminal)) order.push(p.terminal);
                if (!this.collapsed.has(s.id)) rows.push(...this.paneRow(p, tab, focusedPane));
            }
            return v_flex().w_full().flex_none().child(this.spaceHeader(s)).children(rows);
        });
        setAgentOrder(order);
        if (narrow()) return this.rail(list);
        return v_flex().size_full().bg(C.bgSidebar)
            .child(div().w_full().h(35).flex_none().relative()
                .child(div().absolute().left(16).top(9).text_size(12).line_height(AUTO(12)).text_color(C.textTertiary).child("Spaces"))
                .child(div().id("new-space").absolute().right(5).top(5).size(20).rounded(5).cursor_pointer().hover((el) => el.bg(C.bgRowSelected))
                    .tooltip("New space")
                    .on_click(() => openOverlay({ ...LAUNCHER, props: { computer: true, ...this.newSpace } }))
                    .child(image(ICON("plus")).size(12).absolute().left(4).top(4))))
            .child(v_flex().id("space-list").flex_1().min_h(0).overflow_y_scrollbar().pl(8).pr(7).pb(12).gap(12).children(blocks));
    }
}

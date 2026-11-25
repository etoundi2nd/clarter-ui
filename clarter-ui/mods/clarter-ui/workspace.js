// The work area's chrome: the toolbar (tabs, +, Files, Changes, Activity) and the status bar.
import { div, image, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, agents, run, openOverlay, layout, window, settings, nextCommand, checking, exec, appHome } from "herdr";
import { C, ICON, AUTO, stop, LAUNCHER, findLauncher } from "./tokens.js";
import { openSettings } from "./github.js";

const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}\p{Ps}\p{Pi}]+/u, "").replace(/^\[ [!.] \] /, "").trim();

function find(node, id) {
    if (node?.id === id) return node;
    for (const child of node?.children ?? []) {
        const found = find(child, id);
        if (found) return found;
    }
    return null;
}

export function panelShown(id) {
    const panel = find(layout(), "panel"), body = find(layout(), "panel-body");
    return Boolean(panel && !panel.hidden && body?.active === id);
}

export function togglePanel(id) {
    if (panelShown(id)) run("layout.hide", { id: "panel" });
    else { run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); }
}

function tabLabel(tab, lead) {
    const prog = lead?.program?.name;
    const base = tab.named ? tab.name : prog ?? "Terminal";
    if (!lead?.program?.agent) return lead?.program?.shell && !tab.named ? lead.program.key ?? base : base;
    const live = clean(lead.title);
    const telling = live && live !== lead.terminal && live !== prog && !/^[~/]/.test(live) && !live.includes("@");
    return !tab.named && telling ? live : base;
}

export class Toolbar {
    init(cx) {
        findLauncher(exec, appHome);
        if (checking()) return;
        cx.spawn(async (cx) => {
            for (;;) {
                const c = await nextCommand();
                if (/toggle-activity$/.test(c)) togglePanel("activity");
                else if (/settings$/.test(c)) openSettings();
                cx.notify();
            }
        });
    }

    tab(c, i, space) {
        const lead = panes().find((p) => p.tab === c.id && p.program?.agent) ?? panes().find((p) => p.tab === c.id);
        const program = lead?.program;
        const icon = program?.agent && program.icon
            ? (program.tint ? svg(program.icon).size(14).text_color(C.textSecondary) : image(program.icon).size(14))
            : image(ICON("terminal")).size(14);
        const status = c.status === "working"
            ? svg(ICON("spinner")).size(12).flex_none().ml(6).text_color(C.textMutedLegacy).spin(900)
            : c.status === "blocked" || c.status === "done"
                ? div().size(6).flex_none().ml(6).rounded(3).bg(c.status === "blocked" ? C.statusAttention : C.accent) : null;
        return h_flex().id(`tab-${c.id}`).h(29).pl(9).pr(12).flex_none().items_center().rounded(7).border(1).cursor_pointer()
            .border_color(c.active ? C.borderTabActive : "#00000000").bg(c.active ? C.bgTabActive : "#00000000")
            .when(!c.active, (el) => el.hover((s) => s.bg(C.bgRowSelected)))
            .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); if (e.click_count === 2) run("tab.rename", { id: c.id }); })
            .on_click(() => run("tab.select", { id: c.id }))
            .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: space.id } } }); })
            .child(div().size(14).flex_none().child(icon))
            .child(div().ml(7).max_w(200).truncate().text_size(12).line_height(AUTO(12)).font_weight(500)
                .text_color(c.active ? C.textTab : C.textSecondary).child(c.zoomed ? `${tabLabel(c, lead)} Z` : tabLabel(c, lead)))
            .when(Boolean(status), (el) => el.child(status))
            .when(c.active, (el) => el.child(div().id(`close-${c.id}`).ml(7).size(11).flex_none().cursor_pointer()
                .tooltip("Close tab")
                .on_mouse_down("left", stop)
                .on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); })
                .child(image(ICON("close")).size(11))));
    }

    action(id, icon, size, gap, label, active, onClick, tip) {
        return h_flex().id(id).h(24).flex_none().items_center().gap(gap).rounded(5).cursor_pointer()
            .tooltip(tip)
            .on_mouse_down("left", stop)
            .on_click(onClick)
            .child(image(ICON(icon)).size(size).flex_none())
            .child(div().text_size(12).line_height(AUTO(12)).text_color(active ? C.textPrimary : C.textSecondary).child(label));
    }

    render() {
        const space = spaces().find((s) => s.active);
        const tabs = space?.tabs ?? [];
        const root = layout(), sidebar = find(root, "sidebar"), w = window();
        const lights = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights
            ? Math.max(10, (root.traffic_lights[0] + 64) / settings().zoom - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0))
            : 10;
        return h_flex().size_full().min_w(0).bg(C.bgApp).border_b(1).border_color(C.borderSubtle).pl(lights).pr(16).items_center()
            .child(h_flex().id("tab-strip").flex_1().min_w(0).h_full().items_center().gap(4).overflow_x_scrollbar()
                .children(tabs.map((c, i) => this.tab(c, i, space))))
            .child(div().id("tab-new").size(20).flex_none().ml(8).rounded(5).relative().cursor_pointer()
                .hover((s) => s.bg(C.bgRowSelected)).tooltip("New tab or agent")
                .on_mouse_down("left", stop)
                .on_click(() => openOverlay(LAUNCHER))
                .child(image(ICON("plus")).size(12).absolute().left(4).top(4)))
            .child(this.action("panel-files", "file", 13, 7, "Files", panelShown("files"), () => togglePanel("files"), "Files").ml(15))
            .child(this.action("panel-changes", "branch", 12, 8, "Changes", panelShown("changes"), () => togglePanel("changes"), "Changes").ml(21))
            .child(this.action("panel-activity", "layers", 13, 6, "Activity", panelShown("activity"), () => togglePanel("activity"), "Activity (⌘⌥B)").ml(16));
    }
}

export class StatusBar {
    render() {
        const space = spaces().find((s) => s.active);
        const list = agents();
        const needs = list.filter((a) => a.status === "blocked").length;
        const text = (s) => div().flex_none().text_size(12).line_height(AUTO(12)).text_color(C.textSecondary).child(s);
        return h_flex().size_full().bg(C.bgApp).border_t(1).border_color(C.borderSubtle).pl(15).items_center()
            .child(space?.machine ? svg("mods/workspace-chrome/server.svg").size(11).text_color(C.textSecondary) : image(ICON("monitor")).size(11).flex_none())
            .child(text(space?.machine ?? "This computer").ml(7))
            .when(Boolean(space?.branch), (el) => el.child(image(ICON("branch")).size(11).flex_none().ml(11)).child(text(space.branch).ml(9)))
            .child(div().size(6).rounded(3).flex_none().ml(14).bg(C.textTertiary))
            .child(text(`${list.length} ${list.length === 1 ? "agent" : "agents"}`).ml(6))
            .when(needs > 0, (el) => el.child(div().ml(6).text_size(12).text_color(C.statusAttention).child(`· ${needs} ${needs === 1 ? "needs" : "need"} you`)));
    }
}

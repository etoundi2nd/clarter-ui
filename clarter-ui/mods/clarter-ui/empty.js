// The tab that keeps a space without sessions open: Herdr closes a space with its last tab.
import { div, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, panes, run, openOverlay } from "herdr";
import { C, ICON, AUTO, LAUNCHER } from "./tokens.js";

const NAME = "No sessions";

// Tabs keep their name in spaces(); a mod pane has no terminal in panes().
export const isPlaceholder = (tab) => tab.name === NAME && !panes().some((p) => p.tab === tab.id && p.terminal);

export function keepSpace(space) {
    run("tab.new", { space: space.id, name: NAME, mod: "clarter-ui", props: { role: "empty" }, focus: false });
}

// The tabs each placeholder's space had when it was first seen: the tab whose closing opened it
// is still among them, so only a tab opened later replaces it.
const baseline = new Map();

// Called every second by the sidebar.
export function dropPlaceholders() {
    for (const s of spaces()) {
        for (const t of s.tabs.filter(isPlaceholder)) {
            if (!baseline.has(t.id)) baseline.set(t.id, new Set(s.tabs.map((x) => x.id)));
            if (s.tabs.some((x) => !baseline.get(t.id).has(x.id) && !isPlaceholder(x))) {
                baseline.delete(t.id);
                run("tab.close", { id: t.id, confirmed: true });
            }
        }
    }
}

export class Empty {
    render() {
        return v_flex().size_full().bg(C.bgTerminal).items_center().justify_center().gap(12)
            .child(div().text_size(13).line_height(AUTO(13)).text_color(C.textSecondary).child("No sessions in this space"))
            .child(h_flex().id("empty-new").h(28).px(12).gap(7).items_center().rounded(7).border(1).border_color(C.borderTabActive)
                .bg(C.bgTabActive).cursor_pointer().hover((el) => el.bg(C.bgRowSelected))
                .on_click(() => openOverlay(LAUNCHER))
                .child(image(ICON("plus")).size(12))
                .child(div().text_size(12).line_height(AUTO(12)).text_color(C.textTab).child("New tab or agent")));
    }
}

const spaceOf = (tabId) => spaces().find((s) => s.tabs.some((t) => t.id === tabId));

// Closing a space's last session leaves the space: the placeholder tab opens first.
export function closePane(pane) {
    const p = panes().find((x) => x.pane === pane);
    const space = p && spaceOf(p.tab);
    const terminals = space ? panes().filter((x) => x.terminal && space.tabs.some((t) => t.id === x.tab)) : [];
    if (terminals.length === 1 && terminals[0].pane === pane) keepSpace(space);
    run("pane.close", { pane });
}

export function closeTab(id) {
    const space = spaceOf(id);
    if (space?.tabs.length === 1) keepSpace(space);
    run("tab.close", { id });
}

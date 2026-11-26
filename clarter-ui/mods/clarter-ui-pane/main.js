// Pane header of the Clarter UI layout: program icon, name, folder; split, zoom and close
// appear while the pointer is on the header. Props from the app: { pane, terminal }.
import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { panes, props, run, home } from "herdr";

const C = { bg: "#22262b", divider: "#363a3f", title: "#e3e4e6", folder: "#7c7f82", icon: "#adb0b4", hover: "#2d3034" };

function folder(cwd) {
    if (!cwd) return "";
    const h = home();
    return cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
}

export default class FramePane extends View {
    init() { this.hovered = false; }

    button(id, icon, command, args, tip) {
        return div().id(id).p(3).rounded(4).text_color(C.folder).tooltip(tip)
            .hover((s) => s.bg(C.hover).text_color(C.title))
            .on_click((_e, cx) => { cx.stop_propagation(); run(command, args); })
            .child(svg(`mods/pane/${icon}.svg`).size(13));
    }

    render() {
        const p = panes().find((x) => x.pane === props()?.pane);
        if (!p) return div();
        const prog = p.program;
        const name = p.name || (prog?.agent ? prog.name : !prog || prog.shell ? "Terminal" : p.title || prog.name);
        const icon = prog?.agent && prog.icon
            ? (prog.tint ? svg(prog.icon).size(13).text_color(C.icon) : image(prog.icon).size(13))
            : image("mods/clarter-ui-pane/terminal.svg").size(13);
        const pane = p.pane;
        return h_flex().id(`pane-head-${pane}`).size_full().pl(11).pr(8).items_center().bg(C.bg).border_b(1).border_color(C.divider)
            .on_hover((hovered, cx) => { this.hovered = hovered; cx.notify(); })
            .on_click(() => run("pane.focus", { pane }))
            .child(div().size(13).flex_none().child(icon))
            .child(div().ml(8).flex_none().text_size(12).line_height("15px").font_weight(500).text_color(C.title).child(name))
            .child(div().ml(6).flex_1().min_w(0).truncate().text_size(12).line_height("15px").text_color(C.folder).child(folder(p.cwd)))
            .when(p.status === "working", (el) => el.child(svg("mods/clarter-ui/icons/spinner.svg").size(12).flex_none().text_color(C.icon).spin(900)))
            .when(this.hovered, (el) => el.child(h_flex().flex_none().gap(2).ml(6)
                .child(this.button(`split-r-${pane}`, "split-right", "pane.split", { pane, direction: "right" }, "Split right"))
                .child(this.button(`split-d-${pane}`, "split-down", "pane.split", { pane, direction: "down" }, "Split down"))
                .child(this.button(`zoom-${pane}`, p.zoomed ? "unzoom" : "zoom", "pane.zoom", { pane }, p.zoomed ? "Unzoom" : "Zoom"))
                .child(this.button(`close-${pane}`, "close", "pane.close", { pane }, "Close pane"))));
    }
}

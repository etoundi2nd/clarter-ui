// The pull requests one session works on (props.role "prlist", a popup from the sidebar's
// "PR n" chip), as rows like the Activity panel's.
import { div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { props, closeOverlay, exec } from "herdr";
import { C } from "./tokens.js";
import { prRow } from "./github.js";

const MAX_LIST = 400;

export class PrList {
    render() {
        const { prs = [], folder, overlay } = props() ?? {};
        return v_flex().id("pr-menu").w_full().bg(C.bgSidebar).px(4).pb(4)
            .child(div().w_full().h(30).flex_none().relative()
                .child(div().absolute().left(8).top(8).text_size(12).line_height("14px").font_weight(500).text_color(C.textMuted).child("Pull requests in this session"))
                .child(div().absolute().right(9).top(9).text_size(10).line_height("12px").text_color(C.textMuted).child(String(prs.length))))
            .child(v_flex().id("pr-menu-list").w_full().h(Math.min(prs.length * 40, MAX_LIST)).flex_none().overflow_y_scrollbar()
                .children(prs.map((pr) => prRow(pr, {
                    hovered: this.hover === pr.url,
                    onHover: (on, cx) => { this.hover = on ? pr.url : this.hover === pr.url ? null : this.hover; cx.notify(); },
                    onClick: () => { exec("open", [pr.url]); closeOverlay(overlay); },
                    folder,
                }))));
    }
}

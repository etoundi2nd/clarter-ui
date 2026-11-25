// The layout's settings dialog (props.role "settings", opened from the sidebar footer): the
// commands that start an AI tool, which one "AI review" runs, and the prompt it sends.
import { div, image } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { props, closeOverlay, shared, setShared } from "herdr";
import { C, ICON, layoutSettings } from "./tokens.js";

const save = (patch) => setShared("clarter-ui.settings", { ...layoutSettings(shared), ...patch });

export class Settings {
    init(cx) {
        this.add = InputState.new({ value: "", placeholder: "Add a command, e.g. claude-work" });
        this.add.on("submit", (_e, cx) => this.addCommand(cx));
        this.prompt = InputState.new({ value: layoutSettings(shared).reviewPrompt });
        this.prompt.on("change", () => save({ reviewPrompt: this.prompt.value() }));
        this.handle = cx.focus_handle();
    }

    addCommand(cx) {
        const cmd = this.add.value().trim();
        if (!cmd) return;
        const s = layoutSettings(shared);
        save({ aiCommands: s.aiCommands.includes(cmd) ? s.aiCommands : [...s.aiCommands, cmd], aiCommand: s.aiCommands.length ? s.aiCommand : cmd });
        this.add.set_value("");
        cx.notify();
    }

    commandRow(cmd, s) {
        const selected = cmd === s.aiCommand;
        return h_flex().id(`cmd-${cmd}`).w_full().h(30).px(8).items_center().rounded(6).cursor_pointer()
            .hover((st) => st.bg(C.bgRowHover))
            .on_click(() => save({ aiCommand: cmd }))
            .child(div().size(12).flex_none().rounded(6).border(1).border_color(selected ? C.accent : C.textTertiary).relative()
                .when(selected, (el) => el.child(div().size(6).rounded(3).bg(C.accent).absolute().left(2).top(2))))
            .child(div().ml(10).flex_1().min_w(0).truncate().font_family("Menlo").text_size(12).text_color(C.textPrimary).child(cmd))
            .when(selected, (el) => el.child(div().mr(8).flex_none().text_size(10).text_color(C.textMuted).child("AI review")))
            .child(div().id(`rm-${cmd}`).size(20).flex_none().rounded(4).relative().cursor_pointer().tooltip("Remove")
                .hover((st) => st.bg(C.bgRowSelected))
                .on_click((_e, cx) => { cx.stop_propagation(); const rest = s.aiCommands.filter((c) => c !== cmd); save({ aiCommands: rest, aiCommand: selected ? rest[0] ?? null : s.aiCommand }); })
                .child(image(ICON("close-10")).size(10).absolute().left(5).top(5)));
    }

    render() {
        const s = layoutSettings(shared);
        const label = (t) => div().pt(18).pb(4).text_size(12).font_weight(500).text_color(C.textPrimary).child(t);
        const hint = (t) => div().pb(8).text_size(11).line_height("15px").text_color(C.textMuted).child(t);
        const field = (state) => Input.new(state).h(30).px(8).rounded(6).border(1).border_color(C.borderPane).bg(C.bgTerminal).text_size(12).text_color(C.textPrimary);
        return v_flex().id("clarter-settings").track_focus(this.handle)
            .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(props().overlay); cx.stop_propagation(); } })
            .size_full().p(18).bg(C.bgSidebar).text_color(C.textPrimary)
            .child(h_flex().items_center()
                .child(div().flex_1().text_size(15).font_weight(600).child("Layout settings"))
                .child(div().text_size(11).text_color(C.textTertiary).child("Esc")))
            .child(label("AI commands"))
            .child(hint("Commands that start an AI tool in a new terminal, such as shell aliases that sign in to a particular account. The selected one runs for AI review."))
            .child(v_flex().w_full().gap(2).children(s.aiCommands.map((c) => this.commandRow(c, s))))
            .child(h_flex().w_full().mt(6).gap(8)
                .child(div().flex_1().min_w(0).child(field(this.add)))
                .child(h_flex().id("add-cmd").h(30).px(12).flex_none().items_center().rounded(6).cursor_pointer()
                    .bg(C.bgServerControl).border(1).border_color(C.borderServerControl).hover((st) => st.border_color(C.textTertiary))
                    .on_click((_e, cx) => this.addCommand(cx))
                    .child(div().text_size(12).text_color(C.textPrimary).child("Add"))))
            .child(label("Review prompt"))
            .child(hint("The first message of an AI review. {url}, {number} and {title} are the pull request's."))
            .child(field(this.prompt))
            .child(div().flex_1())
            .child(h_flex().pt(16).justify_end()
                .child(h_flex().id("done").h(30).px(14).items_center().rounded(6).cursor_pointer().bg(C.accent)
                    .hover((st) => st.opacity(0.88))
                    .on_click(() => closeOverlay(props().overlay))
                    .child(div().text_size(12).font_weight(500).text_color(C.bgApp).child("Done"))));
    }
}

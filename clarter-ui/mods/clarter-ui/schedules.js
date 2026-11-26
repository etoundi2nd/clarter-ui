// Scheduled runs of herdr-task (a launchd-timed Claude run per task and account), when it is installed:
// `herdr-task list --json`, `run-now <task> <account>`, `on|off <task> <account>`.
import { div, image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec, terminals } from "herdr";
import { C, ICON, stop, age } from "./tokens.js";

const TASK = (args) => exec("sh", ["-c", 'PATH="$HOME/.local/bin:$PATH"; command -v herdr-task >/dev/null || exit 3; herdr-task "$@"', "sh", ...args]);
const norm = (p) => (p ?? "").replace(/\/+$/, "");

export async function loadSchedules(folders) {
    const r = await TASK(["list", "--json"]).catch(() => null);
    if (r?.code !== 0) return [];
    let rows = [];
    try { rows = JSON.parse(r.stdout).rows ?? []; } catch { return []; }
    const wanted = new Set(folders.filter(Boolean).map(norm));
    return rows.filter((row) => wanted.has(norm(row.cwd)));
}

export const scheduleKey = (row) => `${row.task}.${row.account}`;

export const startSchedule = (row) => TASK(["run-now", row.task, row.account]).catch(() => null);
export const switchSchedule = (row, on) => TASK([on ? "on" : "off", row.task, row.account]).catch(() => null);

function until(iso) {
    const s = (Date.parse(iso) - Date.now()) / 1000;
    if (!(s > 0)) return "now";
    if (s < 3600) return `in ${Math.max(1, Math.round(s / 60))}m`;
    if (s < 86400) return `in ${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
    const d = new Date(iso);
    const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    return `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()]} ${s < 6 * 86400 ? "" : `${d.getDate()}.${d.getMonth() + 1}. `}${hm}`;
}

function toggle(id, on, onClick) {
    return div().id(id).w(26).h(14).flex_none().relative().rounded(7).cursor_pointer()
        .bg(on ? C.accent : C.bgSessionToggle)
        .tooltip(on ? "On: runs on schedule. Click to switch off" : "Off. Click to run on schedule")
        .on_mouse_down("left", stop)
        .on_click((_e, cx) => { cx.stop_propagation(); onClick(cx); })
        .child(div().size(10).absolute().top(2).left(on ? 14 : 2).rounded(5).bg(on ? C.textOnEmphasis : C.textSecondary));
}

// A 40px row: the task and its account, when it runs next and how the last run went, Start and the switch.
export function scheduleRow(row, { starting, onStart, onToggle }) {
    const key = scheduleKey(row);
    const running = starting || terminals().some((k) => k.state === "live" && k.labels?.["herdr-task"] === row.task
        && k.labels?.["herdr-task.account"] === row.account);
    const failed = row.outcome && !/^(finished|skipped)/.test(row.outcome);
    const detail = [row.account, row.on && row.next_at ? `next ${until(row.next_at)}` : "off"].join(" · ");
    const last = row.last ? `${row.outcome ?? "ran"} ${age(row.last)} ago` : null;
    return div().id(`schedule-${key}`).w_full().h(40).flex_none().relative()
        .child(v_flex().absolute().left(8).right(100).top(5)
            .child(div().w_full().truncate().text_size(12).line_height("14px").text_color(C.textPrimary)
                .when(!row.on, (el) => el.opacity(0.6)).child(row.task))
            .child(h_flex().w_full().mt(3).min_w(0).text_size(10).line_height("12px")
                .child(div().flex_shrink(1).min_w(0).truncate().text_color(C.textMuted).child(detail))
                .when(Boolean(last), (el) => el.child(div().flex_none().ml(4).text_color(failed ? C.statusError : C.textMuted).child(`· ${last}`)))))
        .child(h_flex().absolute().right(8).top(9).h(22).gap(10).items_center()
            .child(h_flex().id(`schedule-run-${key}`).h(22).pl(5).pr(7).items_center().rounded(4)
                .bg(C.bgServerControl).border(1).border_color(C.borderServerControl)
                .when(!running, (el) => el.cursor_pointer().hover((s) => s.border_color(C.textTertiary))
                    .on_click((_e, cx) => { cx.stop_propagation(); onStart(cx); }))
                .tooltip(running ? "Running" : "Start a run now")
                .on_mouse_down("left", stop)
                .child(running
                    ? svg(ICON("spinner")).size(10).flex_none().text_color(C.textMuted).spin(900)
                    : image(ICON("play")).size(10).flex_none())
                .child(div().ml(4).text_size(11).line_height("14px").text_color(C.textMuted).child(running ? "Running" : "Start")))
            .child(toggle(`schedule-on-${key}`, row.on, onToggle)));
}

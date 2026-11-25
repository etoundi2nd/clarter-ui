// The right panel: pull requests that involve you in the shown space's repo, its servers
// (bin/dev and friends), and the plan limits and context of the session in focus.
import { div, image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { spaces, agents, terminals, focused, run, exec, home, appHome, readTextFile, shared, checking, window, settings } from "herdr";
import { C, ICON, AUTO, stop, age } from "./tokens.js";
import { LIFECYCLE, REVIEW, CI, tooltip } from "./github.js";
import { togglePanel } from "./workspace.js";

const python = (args) => exec("python3", args).catch(() => null);
const json = (r) => { try { return r?.code === 0 ? JSON.parse(r.stdout || "null") : null; } catch { return null; } };
const CODEX = `f=$(ls -t "$HOME"/.codex/sessions/*/*/*/*.jsonl 2>/dev/null | head -n 1); [ -n "$f" ] || exit 0
grep -o '"rate_limits":{.*' "$f" | tail -n 1 | sed 's/^"rate_limits"://' | jq -c '{plan: .plan_type, primary, secondary}' 2>/dev/null`;
const dot = () => h_flex().w(12).flex_none().justify_center().text_size(10).line_height("12px").text_color(C.textMuted).child("•");

function plan(account) {
    if (account?.planDisplayName) return account.planDisplayName.replace(/^claude\s+/i, "");
    if (/max/.test(account?.userRateLimitTier ?? "")) return "Max";
    const org = (account?.organizationType ?? "").replace(/^claude_/, "");
    return org ? org[0].toUpperCase() + org.slice(1) : null;
}

const left = (s) => s < 3600 ? `${Math.max(1, Math.floor(s / 60))}m` : s < 86400 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;

export class Activity {
    init(cx) {
        this.involved = null;
        this.servers = [];
        this.usage = [];
        try { this.seen = JSON.parse(localStorage.getItem("clarter-ui.seenReviews") ?? "{}"); } catch { this.seen = {}; }
        if (checking()) return;
        cx.timer.every(30000, (cx) => this.load(cx));
        cx.timer.every(600000, (cx) => this.refreshUsage(cx));
        this.refreshUsage(cx);
        cx.timer.every(1000, (cx) => { if (spaces().find((s) => s.active)?.id !== this.loadedFor) this.load(cx); });
        this.load(cx);
    }

    load(cx) {
        if (this.busy || window()?.visible === false) return;
        const space = spaces().find((s) => s.active);
        this.busy = true;
        this.loadedFor = space?.id;
        cx.spawn(async (cx) => {
            try {
                if (space?.folder && !space.machine) {
                    this.involved = json(await python(["-I", `${appHome()}/mods/clarter-ui/github.py`, "involved", space.folder]));
                    // A PR seen for the first time is the baseline: only reviews after it count as new.
                    for (const pr of this.involved?.prs ?? []) if (!(pr.url in this.seen)) this.seen[pr.url] = pr.lastReviewAt ?? "";
                    localStorage.setItem("clarter-ui.seenReviews", JSON.stringify(this.seen));
                    const root = this.involved?.url ? (json(await python(["-I", `${appHome()}/mods/clarter-ui/github.py`, "repo", space.folder])) ?? {})[space.folder]?.root : null;
                    this.servers = await this.findServers(root ?? space.folder);
                    this.root = root ?? space.folder;
                } else { this.involved = null; this.servers = []; }
                cx.notify();
            } finally { this.busy = false; }
        });
    }

    async findServers(root) {
        let wanted = ["bin/dev", "bin/server", "bin/servers"];
        try { wanted = JSON.parse(await readTextFile(`${appHome()}/mods/clarter-ui/servers.json`)).commands ?? wanted; } catch {}
        const r = await exec("sh", ["-c", 'cd "$1" && shift && for f; do [ -x "$f" ] && printf "%s\\n" "$f"; done', "sh", root, ...wanted]).catch(() => null);
        return (r?.stdout ?? "").split("\n").filter(Boolean);
    }

    refreshUsage(cx) {
        cx.spawn(async (cx) => { this.usage = await this.loadUsage(); cx.notify(); });
    }

    // One row per Claude account with a session open (its status line saved the limits).
    async loadUsage() {
        const out = [];
        const found = json(await python(["-I", `${appHome()}/mods/clarter-ui/accounts.py`])) ?? { accounts: [] };
        const now = Date.now() / 1000;
        const limit = (label, used, resets) => (resets && resets <= now ? { label, used: 0, left: null } : { label, used: Math.max(0, Math.min(100, used ?? 0)), left: resets ? resets - now : null });
        const many = found.accounts.length > 1;
        for (const acc of found.accounts.filter((x) => x.open && x.limits)) {
            const l = acc.limits;
            out.push({
                key: acc.dir, icon: "icons/claude.svg", plan: plan(acc.oauth), at: acc.at,
                name: many && acc.displayName ? `Claude · ${acc.displayName}` : acc.org ? `Claude ${acc.org}` : "Claude",
                limits: [
                    l.five_hour && limit("5-hour", l.five_hour.used_percentage, l.five_hour.resets_at),
                    l.seven_day && limit("Weekly", l.seven_day.used_percentage, l.seven_day.resets_at),
                    l.seven_day_opus && limit("Weekly · Opus", l.seven_day_opus.used_percentage, l.seven_day_opus.resets_at),
                ].filter(Boolean),
            });
        }
        const codex = json(await exec("sh", ["-c", CODEX]).catch(() => null));
        if (codex) out.push({
            key: "codex", name: "Codex", icon: "icons/codex.svg", plan: codex.plan ? codex.plan[0].toUpperCase() + codex.plan.slice(1) : null, at: null,
            limits: [codex.primary, codex.secondary].filter(Boolean).map((w) => limit(w.window_minutes === 300 ? "5-hour" : w.window_minutes === 10080 ? "Weekly" : `${w.window_minutes}m`, w.used_percent, w.resets_at)),
        });
        return out;
    }

    heading(label, count, divider) {
        return div().w_full().h(30).flex_none().relative()
            .when(divider, (el) => el.child(div().absolute().left(8).right(8).top(0).h(1).bg(C.borderSection)))
            .child(div().absolute().left(8).top(8).text_size(12).line_height("14px").font_weight(500).text_color(C.textMuted).child(label))
            .when(count != null, (el) => el.child(div().absolute().right(9).top(9).text_size(10).line_height("12px").text_color(C.textMuted).child(String(count))));
    }

    prRow(pr) {
        const life = LIFECYCLE[pr.lifecycle] ?? LIFECYCLE.open;
        const fresh = pr.lastReviewAt && pr.lastReviewAt > (this.seen[pr.url] ?? "");
        const ci = pr.ci && CI[pr.ci];
        const review = pr.review && REVIEW[pr.review];
        const small = (s) => div().flex_none().text_size(10).line_height("12px").text_color(C.textMuted).child(s);
        return div().id(`pr-${pr.number}`).w_full().h(40).flex_none().relative().rounded(6).cursor_pointer()
            .hover((s) => s.bg(C.bgRowHover))
            .tooltip(tooltip(pr))
            .on_click((_e, cx) => {
                this.seen[pr.url] = pr.lastReviewAt ?? new Date().toISOString();
                localStorage.setItem("clarter-ui.seenReviews", JSON.stringify(this.seen));
                exec("open", [pr.url]);
                cx.notify();
            })
            .child(image(ICON(life.icon)).size(12).absolute().left(8).top(5))
            .child(h_flex().absolute().left(26).right(8).top(4).h(14).gap(6).items_start()
                .child(div().flex_1().min_w(0).truncate().text_size(12).line_height("14px").text_color(C.textPrimary).child(pr.title))
                .when(Boolean(fresh), (el) => el.child(div().id(`fresh-${pr.number}`).size(12).flex_none().mt(1).tooltip("New review since you last opened it")
                    .child(image(ICON("stack-add")).size(12))))
                .when(Boolean(ci), (el) => el.child(h_flex().flex_none().h(12).mt(1).items_center().tooltip(ci.label)
                    .child(div().text_size(10).line_height("12px").text_color(ci.color).child("CI"))
                    .child(pr.ci === "pending" ? div().size(6).rounded(3).ml(2).bg(C.textMuted) : image(ICON(ci.icon)).size(10).ml(2)))))
            .child(h_flex().absolute().left(26).right(8).top(20).h(12).items_center()
                .child(small(`#${pr.number}`)).child(dot())
                .child(image(ICON("comment")).size(10).flex_none()).child(small(String(pr.comments)))
                .when(Boolean(review), (el) => el
                    .child(dot())
                    .child(image(ICON(review.icon)).size(10).flex_none()).child(small(review.label)))
                .when(pr.reviewers > 0, (el) => el
                    .child(dot())
                    .child(small(`${pr.approvals}/${pr.reviewers}`)))
                .child(div().flex_1())
                .child(small(age(pr.updatedAt))));
    }

    serverRow(cmd, space) {
        const running = terminals().find((k) => k.state === "live" && (k.argv ?? []).some((x) => x === cmd || x.endsWith(`/${cmd}`))
            && (k.labels?.["herdr.space"] ?? null) === space?.id);
        return div().id(`server-${cmd}`).w_full().h(32).flex_none().relative()
            .child(div().absolute().left(8).top(9).text_size(12).line_height("14px").text_color(C.textPrimary).child(cmd))
            .child(h_flex().id(`server-btn-${cmd}`).absolute().right(8).top(5).h(22).pl(5).pr(7).items_center().rounded(4).cursor_pointer()
                .bg(C.bgServerControl).border(1).border_color(C.borderServerControl)
                .hover((s) => s.border_color(C.textTertiary))
                .tooltip(running ? `Stop ${cmd}` : `Start ${cmd} in a new tab`)
                .on_mouse_down("left", stop)
                .on_click((_e, cx) => {
                    cx.stop_propagation();
                    if (running) run("terminal.kill", { terminal: running.address });
                    else run("tab.new", { space: space.id, folder: this.root, name: cmd, argv: [`./${cmd}`], focus: false });
                })
                .child(image(ICON(running ? "stop" : "play")).size(10).flex_none())
                .child(div().ml(4).text_size(11).line_height("14px").text_color(C.textMuted).child(running ? "Stop" : "Start")));
    }

    bar(width, used) {
        const fill = used >= 90 ? C.statusError : used >= 70 ? C.statusWarning : C.statusSuccess;
        return div().w(width).h(13).flex_none().relative()
            .child(div().absolute().left(0).top(4).w(width).h(5).rounded(2.5).bg(C.bgProgressTrack))
            .child(div().absolute().left(0).top(4).w((width * used) / 100).h(5).rounded(2.5).bg(fill));
    }

    provider(u) {
        const ago = u.at ? Math.max(0, Math.round((Date.now() / 1000 - u.at) / 60)) : null;
        return v_flex().w_full().pb(8).flex_none()
            .child(div().w_full().h(26).relative()
                .child(image(u.icon).size(14).rounded(3).absolute().left(8).top(6))
                .child(h_flex().absolute().left(28).right(u.at ? 112 : 8).top(5).h(16).items_center()
                    .child(div().flex_shrink(1).min_w(0).truncate().text_size(12).line_height("14px").font_weight(500).text_color(C.textPrimary).child(u.name))
                    .when(Boolean(u.plan), (el) => el.child(div().ml(6).flex_none().h(16).px(4).rounded(4).bg(C.bgPlanBadge).text_size(10).line_height("16px").text_color(C.textPlan).child(u.plan))))
                .when(ago != null, (el) => el.child(div().absolute().right(8).top(6).text_size(10).line_height("13px").text_color(C.textMuted)
                    .child(ago < 1 ? "updated just now" : `updated ${ago < 60 ? `${ago}m` : `${Math.round(ago / 60)}h`} ago`))))
            .children(u.limits.map((l) => {
                const warn = l.used >= 70;
                return h_flex().w_full().h(24).pt(5).pb(6).px(8).items_start()
                    .child(div().w(84).flex_none().text_size(11).line_height("13px").text_color(C.textMuted).child(l.label))
                    .child(this.bar(84, l.used))
                    .child(h_flex().w(38).flex_none().justify_end().text_size(11).line_height("13px").text_color(warn ? C.statusWarning : C.textPrimary).child(`${Math.round(l.used)}%`))
                    .child(h_flex().w(50).flex_none().justify_end().text_size(10).line_height("13px").text_color(C.textMuted).child(l.left != null ? left(l.left) : ""));
            }));
    }

    session() {
        const address = focused()?.terminal;
        const a = agents().find((x) => x.address === address);
        const info = a ? (shared("clarter-ui.info") ?? {})[a.address] : null;
        if (!a || info?.context == null) return null;
        const where = [a.space_name, a.program?.name].filter(Boolean).join(" · ");
        return v_flex().w_full().flex_none()
            .child(div().w_full().h(24).relative()
                .child(div().absolute().left(8).top(5).text_size(12).line_height("14px").font_weight(500).text_color(C.textPrimary).child("This session"))
                .child(h_flex().absolute().left(100).right(8).top(6).h(13).justify_end().child(div().min_w(0).truncate().text_size(10).line_height("13px").text_color(C.textMuted).child(where))))
            .child(div().w_full().h(20).relative()
                .child(div().absolute().left(8).top(3).child(this.bar(190, info.context)))
                .child(div().absolute().right(8).top(2).text_size(11).line_height("13px").text_color(C.textPrimary).child(`ctx ${Math.round(info.context)}%`)))
            .child(div().w_full().h(24).relative()
                .child(div().absolute().left(8).right(8).top(3).truncate().text_size(10).line_height("13px").text_color(C.textMuted)
                    .child([info.model, info.effort && `${info.effort} effort`, info.cacheUntil && info.cacheUntil > Date.now() / 1000 ? `cache warm for ${left(info.cacheUntil - Date.now() / 1000)}` : info.cacheUntil ? "cache expired" : null].filter(Boolean).join(" · "))));
    }

    render() {
        const space = spaces().find((s) => s.active);
        const prs = this.involved?.prs ?? [];
        const sections = [];
        if (prs.length) sections.push(v_flex().w_full().flex_none()
            .child(this.heading("Pull requests", prs.length, false))
            .child(div().w_full().h(20).relative().child(div().absolute().left(8).top(1).text_size(10).line_height("12px").text_color(C.textMuted).child(`Involved · ${this.involved.repo}`)))
            // Heading and scope line take 50px of the section's half of the panel; the rows scroll in the rest.
            .child(v_flex().id("pr-list").w_full().flex_none().overflow_y_scrollbar()
                // A scroll area needs a definite height to scroll; max_h alone only clips. Rows are 40px.
                .h(this.height > 0 ? Math.min(prs.length * 40, Math.max(40, this.height / 2 - 50)) : prs.length * 40)
                .children(prs.map((pr) => this.prRow(pr)))));
        if (this.servers.length) sections.push(v_flex().w_full().flex_none()
            .child(this.heading("Servers", this.servers.length, sections.length > 0))
            .children(this.servers.map((cmd) => this.serverRow(cmd, space))));
        const session = this.session();
        if (this.usage.length || session) sections.push(v_flex().w_full().flex_none()
            .child(this.heading("Usage", null, sections.length > 0))
            .children(this.usage.map((u) => this.provider(u)))
            .when(Boolean(session), (el) => el.child(session)));
        return v_flex().id("activity-root").size_full().bg(C.bgSidebar)
            .on_size_change((size, cx) => { this.height = size.height / (settings().zoom ?? 1); cx.notify(); })
            .child(div().w_full().h(29).flex_none().relative().border_b(1).border_color(C.borderSubtle)
                .child(div().absolute().left(16).top(7).text_size(12).line_height(AUTO(12)).font_weight(500).text_color(C.textSecondary).child("Activity"))
                .child(div().id("activity-close").absolute().right(13).top(4).size(20).rounded(5).cursor_pointer().hover((s) => s.bg(C.bgRowSelected))
                    .tooltip("Hide Activity (⌘⌥B)")
                    .on_click(() => togglePanel("activity"))
                    .child(image(ICON("layers")).size(14).absolute().left(3).top(3))))
            .child(v_flex().id("activity-body").flex_1().min_h(0).overflow_y_scrollbar().pl(7).pr(9).pt(8).pb(12).gap(12)
                .when(!sections.length, (el) => el.child(div().p(8).text_size(11).text_color(C.textMuted).child(space?.machine ? "Activity shows this computer's spaces only." : "Nothing to show for this space yet.")))
                .children(sections));
    }
}

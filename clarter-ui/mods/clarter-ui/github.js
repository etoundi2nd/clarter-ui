// GitHub pull request states as the design's "GitHub states" frame draws them: an icon and
// a colour per lifecycle and per review state, and the meaning the tooltips spell out.
import { div, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { C, ICON, stop, age, layoutSettings } from "./tokens.js";
import { spaces, run, shared, openOverlay } from "herdr";

export const openSettings = () => openOverlay({ mod: "clarter-ui", kind: "dialog", width: 460, height: 470, props: { role: "settings" } });
const dot = () => h_flex().w(12).flex_none().justify_center().text_size(10).line_height("12px").text_color(C.textMuted).child("•");

export const LIFECYCLE = {
    open: { icon: "gh-pr-open", color: C.fgOpen, label: "Open pull request", meaning: "Unmerged; awaiting review" },
    draft: { icon: "gh-pr-draft", color: C.textMuted, label: "Draft pull request", meaning: "Not ready for review" },
    queued: { icon: "gh-merge-queue", color: C.fgAttention, label: "Queued pull request", meaning: "Waiting in merge queue" },
    merged: { icon: "gh-merge", color: C.fgDone, label: "Merged pull request", meaning: "Merged into the base branch" },
    closed: { icon: "gh-pr-closed", color: C.fgClosed, label: "Closed pull request", meaning: "Closed without merging" },
};

export const REVIEW = {
    approved: { icon: "gh-check", label: "Approved" },
    "changes-requested": { icon: "gh-file-diff", label: "Changes requested" },
    commented: { icon: "gh-comment", label: "Commented" },
    "review-pending": { icon: "gh-dot-fill", label: "Review pending" },
    dismissed: { icon: "gh-x", label: "Dismissed" },
};

export const CI = {
    pass: { color: C.statusSuccess, icon: "check", label: "CI passed" },
    fail: { color: C.statusError, icon: "close-10", label: "CI failed" },
    pending: { color: C.textMuted, icon: "status-dot", label: "CI running" },
};

export function tooltip(pr) {
    const life = LIFECYCLE[pr.lifecycle] ?? LIFECYCLE.open;
    return [
        `#${pr.number} ${pr.title}`,
        `${life.label}: ${life.meaning}`,
        pr.conflict ? "Merge conflict with the base branch" : null,
        pr.review ? `Review: ${REVIEW[pr.review].label}${pr.reviewers ? ` (${pr.approvals}/${pr.reviewers} approvals)` : ""}` : null,
        pr.ci ? CI[pr.ci].label : null,
        "Review, CI and conflicts are separate signals.",
    ].filter(Boolean).join("\n");
}

// The sidebar's chip: lifecycle icon and number, then conflict, review and failed-CI marks.
export function prStatusChip(id, pr, open) {
    const life = LIFECYCLE[pr.lifecycle] ?? LIFECYCLE.open;
    const signals = [
        pr.conflict && image(ICON("merge-conflict")).size(10).flex_none(),
        pr.review && image(ICON(REVIEW[pr.review].icon)).size(10).flex_none(),
        pr.ci === "fail" && image(ICON("ci-failure")).size(10).flex_none(),
    ].filter(Boolean);
    return h_flex().id(id).h(16).flex_none().items_center().cursor_pointer().px(2).rounded(4)
        .hover((s) => s.bg(C.bgSessionToggle))
        .tooltip(tooltip(pr))
        .on_mouse_down("left", stop)
        .on_click((_e, cx) => { cx.stop_propagation(); open(pr.url); })
        .child(image(ICON(life.icon)).size(10).flex_none())
        .child(div().text_size(10).line_height("12px").text_color(life.color).child(String(pr.number)))
        .when(signals.length > 0, (el) => el.child(h_flex().h(16).pl(2).gap(2).items_center().children(signals)))
        .accessibility_label(tooltip(pr));
}

// "AI review": a new tab in folder running the AI command chosen in Layout settings, the review
// prompt as its first message.
export function aiReview(pr, folder) {
    const s = layoutSettings(shared);
    if (!s.aiCommand) return openSettings();
    const space = spaces().find((x) => x.active);
    const task = s.reviewPrompt.replaceAll("{url}", pr.url).replaceAll("{number}", String(pr.number)).replaceAll("{title}", pr.title);
    run("tab.new", { space: space?.id, folder, name: `Review #${pr.number}`, argv: s.aiCommand.trim().split(/\s+/), task, focus: true });
}

function reviewTip() {
    const cmd = layoutSettings(shared).aiCommand;
    return cmd ? `Review this pull request in a new tab with ${cmd}` : "Choose an AI command in Layout settings";
}

// A 40px pull request row (the Activity panel's list, the session PR menu): lifecycle icon,
// title, CI, then number, comments, review, approvals, AI review on hover, and age.
export function prRow(pr, { hovered, onHover, onClick, fresh, folder }) {
    const life = LIFECYCLE[pr.lifecycle] ?? LIFECYCLE.open;
    const ci = pr.ci && CI[pr.ci];
    const review = pr.review && REVIEW[pr.review];
    const small = (s) => div().flex_none().text_size(10).line_height("12px").text_color(C.textMuted).child(s);
    return div().id(`pr-${pr.number}`).w_full().h(40).flex_none().relative().rounded(6).cursor_pointer()
        .hover((s) => s.bg(C.bgRowHover))
        .on_hover(onHover)
        .tooltip(tooltip(pr))
        .on_click((_e, cx) => onClick(cx))
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
            .when(Boolean(hovered), (el) => el
                .child(dot())
                .child(h_flex().id(`ai-review-${pr.number}`).flex_none().h(14).px(3).rounded(3).items_center().cursor_pointer()
                    .hover((s) => s.bg(C.bgRowSelected))
                    .tooltip(reviewTip())
                    .on_mouse_down("left", stop)
                    .on_click((_e, cx) => { cx.stop_propagation(); aiReview(pr, folder); })
                    .child(image(ICON("sparkle")).size(10).flex_none())
                    .child(div().ml(3).text_size(10).line_height("12px").text_color(C.textPrimary).child("AI review"))))
            .child(div().flex_1())
            .child(small(age(pr.updatedAt))));
}

// The sidebar's chip for a session on several pull requests: "PR n" and a chevron; opens the list.
export function prMenuChip(id, prs, onOpen) {
    return h_flex().id(id).h(16).flex_none().items_center().cursor_pointer().pl(3).pr(1).rounded(4)
        .hover((s) => s.bg(C.bgSessionToggle))
        .tooltip(prs.map((p) => `#${p.number} ${p.title}`).join("\n"))
        .on_mouse_down("left", stop)
        .on_click((e, cx) => { cx.stop_propagation(); onOpen(e); })
        .child(div().text_size(10).line_height("12px").text_color(C.textMuted).child(`PR ${prs.length}`))
        .child(image(ICON("chevron-down")).size(8).ml(1).flex_none());
}

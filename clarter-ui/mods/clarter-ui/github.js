// GitHub pull request states as the design's "GitHub states" frame draws them: an icon and
// a colour per lifecycle and per review state, and the meaning the tooltips spell out.
import { div, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { C, ICON, stop } from "./tokens.js";

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

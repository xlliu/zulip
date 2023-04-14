import $ from "jquery";
import _ from "lodash";
import tippy, {delegate} from "tippy.js";

import render_message_inline_image_tooltip from "../templates/message_inline_image_tooltip.hbs";
import render_narrow_to_compose_recipients_tooltip from "../templates/narrow_to_compose_recipients_tooltip.hbs";

import * as compose_state from "./compose_state";
import {$t} from "./i18n";
import * as message_lists from "./message_lists";
import * as narrow_state from "./narrow_state";
import * as popover_menus from "./popover_menus";
import * as reactions from "./reactions";
import * as rows from "./rows";
import * as timerender from "./timerender";
import {parse_html} from "./ui_util";

// For tooltips without data-tippy-content, we use the HTML content of
// a <template> whose id is given by data-tooltip-template-id.
function get_tooltip_content(reference) {
    if ("tooltipTemplateId" in reference.dataset) {
        const template = document.querySelector(
            `template#${CSS.escape(reference.dataset.tooltipTemplateId)}`,
        );
        return template.content.cloneNode(true);
    }
    return "";
}

// Defining observer outside ensures that at max only one observer is active at all times.
let observer;
function hide_tooltip_if_reference_removed(
    target_node,
    config,
    instance,
    nodes_to_check_for_removal,
) {
    // Use MutationObserver to check for removal of nodes on which tooltips
    // are still active.
    if (!target_node) {
        // The tooltip reference was removed from DOM before we reached here.
        // In that case, we simply hide the tooltip.
        // We have to be smart about hiding the instance, so we hide it as soon
        // as it is displayed.
        setTimeout(instance.hide, 0);
        return;
    }
    const callback = function (mutationsList) {
        for (const mutation of mutationsList) {
            for (const node of nodes_to_check_for_removal) {
                // Hide instance if reference's class changes.
                if (mutation.type === "attributes" && mutation.attributeName === "class") {
                    instance.hide();
                }
                // Hide instance if reference is in the removed node list.
                if (Array.prototype.includes.call(mutation.removedNodes, node)) {
                    instance.hide();
                }
            }
        }
    };
    observer = new MutationObserver(callback);
    observer.observe(target_node, config);
}

// We use two delay settings for tooltips. The default "instant"
// version has just a tiny bit of delay to create a natural feeling
// transition, while the "long" version is intended for elements where
// we want to avoid distracting the user with the tooltip
// unnecessarily.
const INSTANT_HOVER_DELAY = [100, 20];
const LONG_HOVER_DELAY = [750, 20];

// We override the defaults set by tippy library here,
// so make sure to check this too after checking tippyjs
// documentation for default properties.
tippy.setDefaultProps({
    // Tooltips shouldn't take more space than mobile widths.
    maxWidth: 300,
    delay: INSTANT_HOVER_DELAY,
    placement: "top",
    // Disable animations to make the tooltips feel snappy.
    animation: false,
    // Show tooltips on long press on touch based devices.
    touch: ["hold", 750],
    // Create the tooltip inside the parent element. This has the
    // undesirable side effect of CSS properties of the parent elements
    // applying to tooltips, which causes ugly clipping if the parent
    // element has overflow rules. Even with that, we prefer to have
    // tooltips appended to the parent so that the tooltip gets removed
    // if the parent is hidden / removed from DOM; which is not the case
    // with appending it to `body` which has side effect of tooltips
    // sticking around due to browser not communicating to tippy that
    // the element has been removed without having a Mutation Observer.
    appendTo: "parent",
    // To add a text tooltip, override this by setting data-tippy-content.
    // To add an HTML tooltip, set data-tooltip-template-id to the id of a <template>.
    // Or, override this with a function returning string (text) or DocumentFragment (HTML).
    content: get_tooltip_content,
});

export function initialize() {
    // Our default tooltip configuration. For this, one simply needs to:
    // * Set `class="tippy-zulip-tooltip"` on an element for enable this.
    // * Set `data-tippy-content="{{t 'Tooltip content' }}"`, often
    //   replacing a `title` attribute on an element that had both.
    // * Set placement; we typically use `data-tippy-placement="top"`.
    delegate("body", {
        target: ".tippy-zulip-tooltip",
    });

    // The below definitions are for specific tooltips that require
    // custom JavaScript code or configuration.  Note that since the
    // below specify the target directly, elements using those should
    // not have the tippy-zulip-tooltip class.

    // message reaction tooltip showing who reacted.
    let observer;
    delegate("body", {
        target: ".message_reaction, .message_reactions .reaction_button",
        placement: "bottom",
        onShow(instance) {
            if (!document.body.contains(instance.reference)) {
                // It is possible for reaction to be removed before `onShow` is triggered,
                // so, we check if the element exists before proceeding.
                return false;
            }
            const $elem = $(instance.reference);
            if (!instance.reference.classList.contains("reaction_button")) {
                const local_id = $elem.attr("data-reaction-id");
                const message_id = rows.get_message_id(instance.reference);
                const title = reactions.get_reaction_title_data(message_id, local_id);
                instance.setContent(title);
            }

            const config = {attributes: false, childList: true, subtree: true};
            const target = $elem.parents(".message_table.focused_table").get(0);
            const nodes_to_check_for_removal = [
                $elem.parents(".recipient_row").get(0),
                $elem.parents(".message_reactions").get(0),
                $elem.get(0),
            ];
            hide_tooltip_if_reference_removed(target, config, instance, nodes_to_check_for_removal);
            return true;
        },
        onHidden(instance) {
            instance.destroy();
            if (observer) {
                observer.disconnect();
            }
        },
        appendTo: () => document.body,
    });

    delegate("body", {
        target: ".compose_control_button",
        // Add some additional delay when they open
        // so that regular users don't have to see
        // them unless they want to.
        delay: LONG_HOVER_DELAY,
        // This ensures that the upload files tooltip
        // doesn't hide behind the left sidebar.
        appendTo: () => document.body,
    });

    delegate("body", {
        target: ".message_control_button",
        // This ensures that the tooltip doesn't
        // hide by the selected message blue border.
        appendTo: () => document.body,
        // Add some additional delay when they open
        // so that regular users don't have to see
        // them unless they want to.
        delay: LONG_HOVER_DELAY,
        onShow(instance) {
            // Handle dynamic "starred messages" and "edit" widgets.
            const $elem = $(instance.reference);
            const tippy_content = $elem.attr("data-tippy-content");
            const $template = $(`#${CSS.escape($elem.attr("data-tooltip-template-id"))}`);

            instance.setContent(tippy_content ?? parse_html($template.html()));
        },
    });

    $("body").on("blur", ".message_control_button", (e) => {
        // Remove tooltip when user is trying to tab through all the icons.
        // If user tabs slowly, tooltips are displayed otherwise they are
        // destroyed before they can be displayed.
        e.currentTarget?._tippy?.destroy();
    });

    delegate("body", {
        target: ".slow-send-spinner",
        appendTo: () => document.body,
        onShow(instance) {
            instance.setContent(
                $t({
                    defaultMessage:
                        "Your message is taking longer than expected to be sent. Sending…",
                }),
            );
            const $elem = $(instance.reference);

            // We need to check for removal of local class from message_row since
            // .slow-send-spinner is not removed (hidden) from DOM when message is sent.
            const target = $elem.parents(".message_row").get(0);
            const config = {attributes: true, childList: false, subtree: false};
            const nodes_to_check_for_removal = [$elem.get(0)];
            hide_tooltip_if_reference_removed(target, config, instance, nodes_to_check_for_removal);
        },
        onHidden(instance) {
            instance.destroy();
        },
    });

    delegate("body", {
        target: ".message_table .message_time",
        appendTo: () => document.body,
        onShow(instance) {
            const $time_elem = $(instance.reference);
            const $row = $time_elem.closest(".message_row");
            const message = message_lists.current.get(rows.id($row));
            // Don't show time tooltip for locally echoed message.
            if (message.locally_echoed) {
                return false;
            }
            const time = new Date(message.timestamp * 1000);
            instance.setContent(timerender.get_full_datetime(time));
            return true;
        },
        onHidden(instance) {
            instance.destroy();
        },
    });

    delegate("body", {
        target: ".recipient_row_date > span",
        appendTo: () => document.body,
        onHidden(instance) {
            instance.destroy();
        },
    });

    // In case of recipient bar icons, following change
    // ensures that tooltip doesn't hide behind the message
    // box or it is not limited by the parent container.
    delegate("body", {
        target: [
            ".recipient_bar_icon",
            "#streams_header .sidebar-title",
            "#userlist-title",
            "#user_filter_icon",
            "#scroll-to-bottom-button-clickable-area",
            ".code_external_link",
            ".spectator_narrow_login_button",
            "#stream-specific-notify-table .unmute_stream",
            "#add_streams_tooltip",
            "#filter_streams_tooltip",
        ],
        appendTo: () => document.body,
    });

    delegate("body", {
        target: ".rendered_markdown time",
        content: timerender.get_markdown_time_tooltip,
        appendTo: () => document.body,
        onHidden(instance) {
            instance.destroy();
        },
    });

    delegate("body", {
        target: [
            ".rendered_markdown .copy_codeblock",
            "#compose_top_right [data-tippy-content]",
            "#compose_top_right [data-tooltip-template-id]",
        ],
        delay: LONG_HOVER_DELAY,
        appendTo: () => document.body,
        onHidden(instance) {
            instance.destroy();
        },
    });

    delegate("body", {
        target: ".narrow_to_compose_recipients",
        appendTo: () => document.body,
        content() {
            const narrow_filter = narrow_state.filter();
            let display_current_view;
            if (narrow_state.is_message_feed_visible()) {
                if (narrow_filter === undefined) {
                    display_current_view = $t({defaultMessage: "Currently viewing all messages."});
                } else if (
                    _.isEqual(narrow_filter.sorted_term_types(), ["stream"]) &&
                    compose_state.get_message_type() === "stream" &&
                    narrow_filter.operands("stream")[0] === compose_state.stream_name()
                ) {
                    display_current_view = $t({
                        defaultMessage: "Currently viewing the entire stream.",
                    });
                } else if (
                    _.isEqual(narrow_filter.sorted_term_types(), ["is-private"]) &&
                    compose_state.get_message_type() === "private"
                ) {
                    display_current_view = $t({
                        defaultMessage: "Currently viewing all direct messages.",
                    });
                }
            }

            return parse_html(render_narrow_to_compose_recipients_tooltip({display_current_view}));
        },
        onHidden(instance) {
            instance.destroy();
        },
    });

    delegate("body", {
        target: [".enter_sends_true", ".enter_sends_false"],
        delay: LONG_HOVER_DELAY,
        content: $t({defaultMessage: "Change send shortcut"}),
        onShow() {
            // Don't show tooltip if the popover is displayed.
            if (popover_menus.is_compose_enter_sends_popover_displayed()) {
                return false;
            }
            return true;
        },
        appendTo: () => document.body,
    });

    delegate("body", {
        target: ".message_inline_image > a > img",
        appendTo: () => document.body,
        // Add a short delay so the user can mouseover several inline images without
        // tooltips showing and hiding rapidly
        delay: [300, 20],
        onShow(instance) {
            // Some message_inline_images aren't actually images with a title,
            // for example youtube videos, so we default to the actual href
            const title =
                $(instance.reference).parent().attr("aria-label") ||
                $(instance.reference).parent().attr("href");
            instance.setContent(parse_html(render_message_inline_image_tooltip({title})));

            const target_node = $(instance.reference)
                .parents(".message_table.focused_table")
                .get(0);
            const config = {attributes: false, childList: true, subtree: false};
            const nodes_to_check_for_removal = [
                $(instance.reference).parents(".message_inline_image").get(0),
            ];
            hide_tooltip_if_reference_removed(
                target_node,
                config,
                instance,
                nodes_to_check_for_removal,
            );
        },
        onHidden(instance) {
            instance.destroy();
        },
    });

    delegate("body", {
        target: ".image-info-wrapper > .image-description > .title",
        appendTo: () => document.body,
        onShow(instance) {
            const title = $(instance.reference).attr("aria-label");
            const filename = $(instance.reference).prop("data-filename");
            const $markup = $("<span>").text(title);
            if (title !== filename) {
                // If the image title is the same as the filename, there's no reason
                // to show this next line.
                const second_line = $t({defaultMessage: "File name: {filename}"}, {filename});
                $markup.append($("<br>"), $("<span>").text(second_line));
            }
            instance.setContent($markup[0]);
        },
        onHidden(instance) {
            instance.destroy();
        },
    });

    delegate("body", {
        // Configure tooltips for the stream_sorter_toggle buttons.

        // TODO: Ideally, we'd extend this to be a common mechanism for
        // tab switchers, with the strings living in a more normal configuration
        // location.
        target: ".stream_sorter_toggle .ind-tab [data-tippy-content]",

        // Adjust their placement to `bottom`.
        placement: "bottom",

        // Avoid inheriting `position: relative` CSS on the stream sorter widget.
        appendTo: () => document.body,
    });

    delegate("body", {
        // This tooltip appears on the "Summary" checkboxes in
        // settings > custom profile fields, when at the limit of 2
        // fields with display_in_profile_summary enabled.
        target: [
            "#profile-field-settings .display_in_profile_summary_tooltip",
            "#edit-custom-profile-field-form-modal .display_in_profile_summary_tooltip",
            "#add-new-custom-profile-field-form .display_in_profile_summary_tooltip",
        ],
        content: $t({
            defaultMessage: "Only 2 custom profile fields can be displayed on the user card.",
        }),
        appendTo: () => document.body,
        onTrigger(instance) {
            // Sometimes just removing class is not enough to destroy/remove tooltip, especially in
            // "Add a new custom profile field" form, so here we are manually calling `destroy()`.
            if (!instance.reference.classList.contains("display_in_profile_summary_tooltip")) {
                instance.destroy();
            }
        },
    });

    delegate("body", {
        target: ["#full_name_input_container.disabled_setting_tooltip"],
        content: $t({
            defaultMessage:
                "Name changes are disabled in this organization. Contact an administrator to change your name.",
        }),
        appendTo: () => document.body,
        onHidden(instance) {
            instance.destroy();
        },
    });

    delegate("body", {
        target: ["#change_email_button_container.disabled_setting_tooltip"],
        content: $t({defaultMessage: "Email address changes are disabled in this organization."}),
        appendTo: () => document.body,
        onHidden(instance) {
            instance.destroy();
        },
    });

    delegate("body", {
        target: ["#deactivate_account_container.disabled_setting_tooltip"],
        content: $t({
            defaultMessage:
                "Because you are the only organization owner, you cannot deactivate your account.",
        }),
        appendTo: () => document.body,
        onHidden(instance) {
            instance.destroy();
        },
    });

    delegate("body", {
        target: ["#deactivate_realm_button_container.disabled_setting_tooltip"],
        content: $t({
            defaultMessage: "Only organization owners may deactivate an organization.",
        }),
        appendTo: () => document.body,
        onHidden(instance) {
            instance.destroy();
        },
    });

    delegate("body", {
        target: "#pm_tooltip_container",
        onShow(instance) {
            if ($(".private_messages_container").hasClass("zoom-in")) {
                return false;
            }

            if ($("#toggle_private_messages_section_icon").hasClass("fa-caret-down")) {
                instance.setContent(
                    $t({
                        defaultMessage: "Collapse direct messages",
                    }),
                );
            } else {
                instance.setContent($t({defaultMessage: "Expand direct messages"}));
            }
            return true;
        },
        delay: LONG_HOVER_DELAY,
        appendTo: () => document.body,
    });

    delegate("body", {
        target: "#show_all_private_messages",
        placement: "bottom",
        content: $t({
            defaultMessage: "All direct messages (P)",
        }),
        appendTo: () => document.body,
    });

    delegate("body", {
        target: ".view_user_card_tooltip",
        content: $t({
            defaultMessage: "View user card (u)",
        }),
        delay: LONG_HOVER_DELAY,
        appendTo: () => document.body,
    });
}

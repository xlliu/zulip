/* Module for popovers that have been ported to the modern
   TippyJS/Popper popover library from the legacy Bootstrap
   popovers system in popovers.js. */

import ClipboardJS from "clipboard";
import $ from "jquery";
import tippy, {delegate} from "tippy.js";

import render_actions_popover_content from "../templates/actions_popover_content.hbs";
import render_all_messages_sidebar_actions from "../templates/all_messages_sidebar_actions.hbs";
import render_compose_control_buttons_popover from "../templates/compose_control_buttons_popover.hbs";
import render_compose_select_enter_behaviour_popover from "../templates/compose_select_enter_behaviour_popover.hbs";
import render_delete_topic_modal from "../templates/confirm_dialog/confirm_delete_topic.hbs";
import render_drafts_sidebar_actions from "../templates/drafts_sidebar_action.hbs";
import render_left_sidebar_stream_setting_popover from "../templates/left_sidebar_stream_setting_popover.hbs";
import render_mobile_message_buttons_popover_content from "../templates/mobile_message_buttons_popover_content.hbs";
import render_starred_messages_sidebar_actions from "../templates/starred_messages_sidebar_actions.hbs";
import render_topic_sidebar_actions from "../templates/topic_sidebar_actions.hbs";

import * as blueslip from "./blueslip";
import * as channel from "./channel";
import * as common from "./common";
import * as compose_actions from "./compose_actions";
import * as condense from "./condense";
import * as confirm_dialog from "./confirm_dialog";
import * as drafts from "./drafts";
import * as emoji_picker from "./emoji_picker";
import * as giphy from "./giphy";
import {$t, $t_html} from "./i18n";
import * as message_edit from "./message_edit";
import * as message_edit_history from "./message_edit_history";
import * as message_lists from "./message_lists";
import * as narrow_state from "./narrow_state";
import * as popover_menus_data from "./popover_menus_data";
import * as popovers from "./popovers";
import * as read_receipts from "./read_receipts";
import * as rows from "./rows";
import * as settings_data from "./settings_data";
import * as starred_messages from "./starred_messages";
import * as starred_messages_ui from "./starred_messages_ui";
import * as stream_popover from "./stream_popover";
import {parse_html} from "./ui_util";
import * as unread_ops from "./unread_ops";
import {user_settings} from "./user_settings";
import * as user_topics from "./user_topics";

let message_actions_popover_keyboard_toggle = false;

const popover_instances = {
    compose_control_buttons: null,
    starred_messages: null,
    drafts: null,
    all_messages: null,
    message_actions: null,
    stream_settings: null,
    compose_mobile_button: null,
    compose_enter_sends: null,
    topics_menu: null,
};

export function sidebar_menu_instance_handle_keyboard(instance, key) {
    const items = get_popover_items_for_instance(instance);
    popovers.popover_items_handle_keyboard(key, items);
}

export function get_visible_instance() {
    return Object.values(popover_instances).find(Boolean);
}
export function get_topic_menu_popover() {
    return popover_instances.topics_menu;
}

export function get_compose_control_buttons_popover() {
    return popover_instances.compose_control_buttons;
}

export function get_starred_messages_popover() {
    return popover_instances.starred_messages;
}

export function is_compose_enter_sends_popover_displayed() {
    return popover_instances.compose_enter_sends?.state.isVisible;
}

function get_popover_items_for_instance(instance) {
    const $current_elem = $(instance.popper);
    const class_name = $current_elem.attr("class");

    if (!$current_elem) {
        blueslip.error(
            `Trying to get menu items when popover with class "${class_name}" is closed.`,
        );
        return undefined;
    }

    return $current_elem.find("li:not(.divider):visible a");
}

const default_popover_props = {
    delay: 0,
    appendTo: () => document.body,
    trigger: "click",
    interactive: true,
    hideOnClick: true,
    /* The light-border TippyJS theme is a bit of a misnomer; it
       is a popover styling similar to Bootstrap.  We've also customized
       its CSS to support Zulip's dark theme. */
    theme: "light-border",
    // The maxWidth has been set to "none" to avoid the default value of 300px.
    maxWidth: "none",
    touch: true,
    /* Don't use allow-HTML here since it is unsafe. Instead, use `parse_html`
       to generate the required html */
};

const left_sidebar_tippy_options = {
    placement: "right",
    popperOptions: {
        modifiers: [
            {
                name: "flip",
                options: {
                    fallbackPlacements: "bottom",
                },
            },
        ],
    },
};

export function any_active() {
    return Boolean(get_visible_instance());
}

function on_show_prep(instance) {
    $(instance.popper).on("click", (e) => {
        // Popover is not hidden on click inside it unless the click handler for the
        // element explicitly hides the popover when handling the event.
        // `stopPropagation` is required here to avoid global click handlers from
        // being triggered.
        e.stopPropagation();
    });
    $(instance.popper).one("click", ".navigate_and_close_popover", (e) => {
        // Handler for links inside popover which don't need a special click handler.
        e.stopPropagation();
        instance.hide();
    });
    popovers.hide_all_except_sidebars();
}

function tippy_no_propagation(target, popover_props) {
    // For some elements, such as the click target to open the message
    // actions menu, we want to avoid propagating the click event to
    // parent elements. Tippy's built-in `delegate` method does not
    // have an option to do stopPropagation, so we use this method to
    // open the Tippy popovers associated with such elements.
    //
    // A click on the click target will close the menu; for this to
    // work correctly without leaking, all callers need call
    // `instance.destroy()` inside their `onHidden` handler.
    //
    // TODO: Should we instead we wrap the caller's `onHidden` hook,
    // if any, to add `instance.destroy()`?
    $("body").on("click", target, (e) => {
        e.preventDefault();
        e.stopPropagation();
        const instance = e.currentTarget._tippy;

        if (instance) {
            instance.hide();
            return;
        }

        tippy(e.currentTarget, {
            ...default_popover_props,
            showOnCreate: true,
            ...popover_props,
        });
    });
}

export function toggle_message_actions_menu(message) {
    if (message.locally_echoed) {
        // Don't open the popup for locally echoed messages for now.
        // It creates bugs with things like keyboard handlers when
        // we get the server response.
        return true;
    }

    const $popover_reference = $(".selected_message .actions_hover .zulip-icon-ellipsis-v-solid");
    message_actions_popover_keyboard_toggle = true;
    $popover_reference.trigger("click");
    return true;
}

export function initialize() {
    tippy_no_propagation("#streams_inline_icon", {
        onShow(instance) {
            popover_instances.stream_settings = instance;
            const can_create_streams =
                settings_data.user_can_create_private_streams() ||
                settings_data.user_can_create_public_streams() ||
                settings_data.user_can_create_web_public_streams();
            on_show_prep(instance);

            if (!can_create_streams) {
                // If the user can't create streams, we directly
                // navigate them to the Manage streams subscribe UI.
                window.location.assign("#streams/all");
                // Returning false from an onShow handler cancels the show.
                return false;
            }

            instance.setContent(parse_html(render_left_sidebar_stream_setting_popover()));
            //  When showing the popover menu, we want the
            // "Add streams" and the "Filter streams" tooltip
            //  to appear below the "Add streams" icon.
            const add_streams_tooltip = $("#add_streams_tooltip").get(0);
            add_streams_tooltip._tippy?.setProps({
                placement: "bottom",
            });
            const filter_streams_tooltip = $("#filter_streams_tooltip").get(0);
            // If `filter_streams_tooltip` is not triggered yet, this will set its initial placement.
            filter_streams_tooltip.dataset.tippyPlacement = "bottom";
            filter_streams_tooltip._tippy?.setProps({
                placement: "bottom",
            });
            return true;
        },
        onHidden(instance) {
            instance.destroy();
            popover_instances.stream_settings = undefined;
            //  After the popover menu is closed, we want the
            //  "Add streams" and the "Filter streams" tooltip
            //  to appear at it's original position that is
            //  above the "Add streams" icon.
            const add_streams_tooltip = $("#add_streams_tooltip").get(0);
            add_streams_tooltip._tippy?.setProps({
                placement: "top",
            });
            const filter_streams_tooltip = $("#filter_streams_tooltip").get(0);
            filter_streams_tooltip.dataset.tippyPlacement = "top";
            filter_streams_tooltip._tippy?.setProps({
                placement: "top",
            });
        },
    });

    // compose box buttons popover shown on mobile widths.
    // We want this click event to propagate and hide other popovers
    // that could possibly obstruct user from using this popover.
    delegate("body", {
        ...default_popover_props,
        target: ".compose_mobile_button",
        placement: "top",
        onShow(instance) {
            popover_instances.compose_mobile_button = instance;
            on_show_prep(instance);
            instance.setContent(
                parse_html(
                    render_mobile_message_buttons_popover_content({
                        is_in_private_narrow: narrow_state.narrowed_to_pms(),
                    }),
                ),
            );
        },
        onMount(instance) {
            const $popper = $(instance.popper);
            $popper.one("click", ".compose_mobile_stream_button", (e) => {
                compose_actions.start("stream", {trigger: "new topic button"});
                e.stopPropagation();
                instance.hide();
            });
            $popper.one("click", ".compose_mobile_private_button", (e) => {
                compose_actions.start("private");
                e.stopPropagation();
                instance.hide();
            });
        },
        onHidden(instance) {
            // Destroy instance so that event handlers
            // are destroyed too.
            instance.destroy();
            popover_instances.compose_control_button = undefined;
        },
    });

    // Click event handlers for it are handled in `compose_ui` and
    // we don't want to close this popover on click inside it but
    // only if user clicked outside it.
    tippy_no_propagation(".compose_control_menu_wrapper", {
        placement: "top",
        onShow(instance) {
            instance.setContent(
                parse_html(
                    render_compose_control_buttons_popover({
                        giphy_enabled: giphy.is_giphy_enabled(),
                    }),
                ),
            );
            popover_instances.compose_control_buttons = instance;
            popovers.hide_all_except_sidebars();
        },
        onHidden(instance) {
            instance.destroy();
            popover_instances.compose_control_buttons = undefined;
        },
    });

    tippy_no_propagation("#stream_filters .topic-sidebar-menu-icon", {
        ...left_sidebar_tippy_options,
        onShow(instance) {
            popover_instances.topics_menu = instance;
            on_show_prep(instance);
            const elt = $(instance.reference).closest(".topic-sidebar-menu-icon").expectOne()[0];
            const $stream_li = $(elt).closest(".narrow-filter").expectOne();
            const topic_name = $(elt).closest("li").expectOne().attr("data-topic-name");
            const url = $(elt).closest("li").find(".topic-name").expectOne().prop("href");
            const stream_id = stream_popover.elem_to_stream_id($stream_li);

            instance.context = popover_menus_data.get_topic_popover_content_context({
                stream_id,
                topic_name,
                url,
            });
            instance.setContent(parse_html(render_topic_sidebar_actions(instance.context)));
        },
        onMount(instance) {
            const $popper = $(instance.popper);
            const {stream_id, topic_name} = instance.context;

            if (!stream_id) {
                instance.hide();
                return;
            }

            $popper.one("click", ".sidebar-popover-unmute-topic", () => {
                user_topics.set_user_topic_visibility_policy(
                    stream_id,
                    topic_name,
                    user_topics.all_visibility_policies.UNMUTED,
                );
                instance.hide();
            });

            $popper.one("click", ".sidebar-popover-remove-unmute", () => {
                user_topics.set_user_topic_visibility_policy(
                    stream_id,
                    topic_name,
                    user_topics.all_visibility_policies.INHERIT,
                );
                instance.hide();
            });

            $popper.one("click", ".sidebar-popover-mute-topic", () => {
                user_topics.set_user_topic_visibility_policy(
                    stream_id,
                    topic_name,
                    user_topics.all_visibility_policies.MUTED,
                );
                instance.hide();
            });

            $popper.one("click", ".sidebar-popover-remove-mute", () => {
                user_topics.set_user_topic_visibility_policy(
                    stream_id,
                    topic_name,
                    user_topics.all_visibility_policies.INHERIT,
                );
                instance.hide();
            });

            $popper.one("click", ".sidebar-popover-unstar-all-in-topic", () => {
                starred_messages_ui.confirm_unstar_all_messages_in_topic(
                    Number.parseInt(stream_id, 10),
                    topic_name,
                );
                instance.hide();
            });

            $popper.one("click", ".sidebar-popover-mark-topic-read", () => {
                unread_ops.mark_topic_as_read(stream_id, topic_name);
                instance.hide();
            });

            $popper.one("click", ".sidebar-popover-delete-topic-messages", () => {
                const html_body = render_delete_topic_modal({topic_name});

                confirm_dialog.launch({
                    html_heading: $t_html({defaultMessage: "Delete topic"}),
                    help_link: "/help/delete-a-topic",
                    html_body,
                    on_click() {
                        message_edit.delete_topic(stream_id, topic_name);
                    },
                });

                instance.hide();
            });

            $popper.one("click", ".sidebar-popover-toggle-resolved", () => {
                message_edit.with_first_message_id(stream_id, topic_name, (message_id) => {
                    message_edit.toggle_resolve_topic(message_id, topic_name);
                });

                instance.hide();
            });

            $popper.one("click", ".sidebar-popover-move-topic-messages", () => {
                stream_popover.build_move_topic_to_stream_popover(stream_id, topic_name);
                instance.hide();
            });

            new ClipboardJS($popper.find(".sidebar-popover-copy-link-to-topic")[0]).on(
                "success",
                () => {
                    instance.hide();
                },
            );
        },
        onHidden(instance) {
            instance.destroy();
            popover_instances.topics_menu = undefined;
        },
    });

    tippy_no_propagation(".open_enter_sends_dialog", {
        placement: "top",
        onShow(instance) {
            on_show_prep(instance);
            instance.setContent(
                parse_html(
                    render_compose_select_enter_behaviour_popover({
                        enter_sends_true: user_settings.enter_sends,
                    }),
                ),
            );
        },
        onMount(instance) {
            popover_instances.compose_enter_sends = instance;
            common.adjust_mac_kbd_tags(".enter_sends_choices kbd");

            $(instance.popper).one("click", ".enter_sends_choice", (e) => {
                let selected_behaviour = $(e.currentTarget)
                    .find("input[type='radio']")
                    .attr("value");
                selected_behaviour = selected_behaviour === "true"; // Convert to bool
                user_settings.enter_sends = selected_behaviour;
                $(`.enter_sends_${!selected_behaviour}`).hide();
                $(`.enter_sends_${selected_behaviour}`).show();

                // Refocus in the content box so you can continue typing or
                // press Enter to send.
                $("#compose-textarea").trigger("focus");

                channel.patch({
                    url: "/json/settings",
                    data: {enter_sends: selected_behaviour},
                });
                e.stopPropagation();
                instance.hide();
            });
        },
        onHidden(instance) {
            instance.destroy();
            popover_instances.compose_enter_sends = undefined;
        },
    });

    tippy_no_propagation(".actions_hover .zulip-icon-ellipsis-v-solid", {
        // The is our minimum supported width for mobile. We shouldn't
        // make the popover wider than this.
        maxWidth: "320px",
        placement: "bottom",
        popperOptions: {
            modifiers: [
                {
                    // The placement is set to bottom, but if that placement does not fit,
                    // the opposite top placement will be used.
                    name: "flip",
                    options: {
                        fallbackPlacements: ["top", "left"],
                    },
                },
            ],
        },
        onShow(instance) {
            on_show_prep(instance);
            const $row = $(instance.reference).closest(".message_row");
            const message_id = rows.id($row);
            message_lists.current.select_id(message_id);
            const args = popover_menus_data.get_actions_popover_content_context(message_id);
            instance.setContent(parse_html(render_actions_popover_content(args)));
            $row.addClass("has_popover has_actions_popover");
        },
        onMount(instance) {
            if (message_actions_popover_keyboard_toggle) {
                popovers.focus_first_action_popover_item();
                message_actions_popover_keyboard_toggle = false;
            }
            popover_instances.message_actions = instance;

            // We want click events to propagate to `instance` so that
            // instance.hide gets called.
            const $popper = $(instance.popper);
            $popper.one("click", ".respond_button", (e) => {
                // Arguably, we should fetch the message ID to respond to from
                // e.target, but that should always be the current selected
                // message in the current message list (and
                // compose_actions.respond_to_message doesn't take a message
                // argument).
                compose_actions.quote_and_reply({trigger: "popover respond"});
                e.preventDefault();
                e.stopPropagation();
                instance.hide();
            });

            $popper.one("click", ".popover_edit_message, .popover_view_source", (e) => {
                const message_id = $(e.currentTarget).data("message-id");
                const $row = message_lists.current.get_row(message_id);
                message_edit.start($row);
                e.preventDefault();
                e.stopPropagation();
                instance.hide();
            });

            $popper.one("click", ".popover_move_message", (e) => {
                const message_id = $(e.currentTarget).data("message-id");
                const message = message_lists.current.get(message_id);
                stream_popover.build_move_topic_to_stream_popover(
                    message.stream_id,
                    message.topic,
                    message,
                );
                e.preventDefault();
                e.stopPropagation();
                instance.hide();
            });

            $popper.one("click", ".mark_as_unread", (e) => {
                const message_id = $(e.currentTarget).data("message-id");
                unread_ops.mark_as_unread_from_here(message_id);
                e.preventDefault();
                e.stopPropagation();
                instance.hide();
            });

            $popper.one("click", ".popover_toggle_collapse", (e) => {
                const message_id = $(e.currentTarget).data("message-id");
                const $row = message_lists.current.get_row(message_id);
                const message = message_lists.current.get(rows.id($row));
                if ($row) {
                    if (message.collapsed) {
                        condense.uncollapse($row);
                    } else {
                        condense.collapse($row);
                    }
                }
                e.preventDefault();
                e.stopPropagation();
                instance.hide();
            });

            $popper.one("click", ".rehide_muted_user_message", (e) => {
                const message_id = $(e.currentTarget).data("message-id");
                const $row = message_lists.current.get_row(message_id);
                const message = message_lists.current.get(rows.id($row));
                const message_container = message_lists.current.view.message_containers.get(
                    message.id,
                );
                if ($row && !message_container.is_hidden) {
                    message_lists.current.view.hide_revealed_message(message_id);
                }
                e.preventDefault();
                e.stopPropagation();
                instance.hide();
            });

            $popper.one("click", ".view_edit_history", (e) => {
                const message_id = $(e.currentTarget).data("message-id");
                const $row = message_lists.current.get_row(message_id);
                const message = message_lists.current.get(rows.id($row));
                message_edit_history.show_history(message);
                $("#message-history-cancel").trigger("focus");
                e.preventDefault();
                e.stopPropagation();
                instance.hide();
            });

            $popper.one("click", ".view_read_receipts", (e) => {
                const message_id = $(e.currentTarget).data("message-id");
                read_receipts.show_user_list(message_id);
                e.preventDefault();
                e.stopPropagation();
                instance.hide();
            });

            $popper.one("click", ".delete_message", (e) => {
                const message_id = $(e.currentTarget).data("message-id");
                message_edit.delete_message(message_id);
                e.preventDefault();
                e.stopPropagation();
                instance.hide();
            });

            $popper.one("click", ".reaction_button", (e) => {
                const message_id = $(e.currentTarget).data("message-id");
                // Don't propagate the click event since `toggle_emoji_popover` opens a
                // emoji_picker which we don't want to hide after actions popover is hidden.
                e.stopPropagation();
                e.preventDefault();
                emoji_picker.toggle_emoji_popover(
                    instance.reference.parentElement,
                    message_id,
                    true,
                );
                instance.hide();
            });

            new ClipboardJS($popper.find(".copy_link")[0]).on("success", (e) => {
                // e.trigger returns the DOM element triggering the copy action
                const message_id = e.trigger.dataset.messageId;
                const $row = $(`[zid='${CSS.escape(message_id)}']`);
                $row.find(".alert-msg")
                    .text($t({defaultMessage: "Copied!"}))
                    .css("display", "block")
                    .delay(1000)
                    .fadeOut(300);

                setTimeout(() => {
                    // The Clipboard library works by focusing to a hidden textarea.
                    // We unfocus this so keyboard shortcuts, etc., will work again.
                    $(":focus").trigger("blur");
                }, 0);
                instance.hide();
            });
        },
        onHidden(instance) {
            const $row = $(instance.reference).closest(".message_row");
            $row.removeClass("has_popover has_actions_popover");
            instance.destroy();
            popover_instances.message_actions = undefined;
            message_actions_popover_keyboard_toggle = false;
        },
    });

    // Starred messages popover
    tippy_no_propagation(".starred-messages-sidebar-menu-icon", {
        ...left_sidebar_tippy_options,
        onMount(instance) {
            const $popper = $(instance.popper);
            popover_instances.starred_messages = instance;

            $popper.one("click", "#unstar_all_messages", () => {
                starred_messages_ui.confirm_unstar_all_messages();
                instance.hide();
            });
            $popper.one("click", "#toggle_display_starred_msg_count", () => {
                const data = {};
                const starred_msg_counts = user_settings.starred_message_counts;
                data.starred_message_counts = JSON.stringify(!starred_msg_counts);

                channel.patch({
                    url: "/json/settings",
                    data,
                });
                instance.hide();
            });
        },
        onShow(instance) {
            popovers.hide_all_except_sidebars();
            const show_unstar_all_button = starred_messages.get_count() > 0;

            instance.setContent(
                parse_html(
                    render_starred_messages_sidebar_actions({
                        show_unstar_all_button,
                        starred_message_counts: user_settings.starred_message_counts,
                    }),
                ),
            );
        },
        onHidden(instance) {
            instance.destroy();
            popover_instances.starred_messages = undefined;
        },
    });

    // Drafts popover
    tippy_no_propagation(".drafts-sidebar-menu-icon", {
        ...left_sidebar_tippy_options,
        onMount(instance) {
            const $popper = $(instance.popper);
            $popper.addClass("drafts-popover");
            popover_instances.drafts = instance;

            $popper.one("click", "#delete_all_drafts_sidebar", () => {
                drafts.confirm_delete_all_drafts();
                instance.hide();
            });
        },
        onShow(instance) {
            popovers.hide_all_except_sidebars();

            instance.setContent(parse_html(render_drafts_sidebar_actions({})));
        },
        onHidden(instance) {
            instance.destroy();
            popover_instances.drafts = undefined;
        },
    });

    // All messages popover
    tippy_no_propagation(".all-messages-sidebar-menu-icon", {
        ...left_sidebar_tippy_options,
        onMount(instance) {
            const $popper = $(instance.popper);
            $popper.addClass("all-messages-popover");
            popover_instances.all_messages = instance;

            $popper.one("click", "#mark_all_messages_as_read", () => {
                unread_ops.confirm_mark_all_as_read();
                instance.hide();
            });
        },
        onShow(instance) {
            popovers.hide_all_except_sidebars();
            instance.setContent(parse_html(render_all_messages_sidebar_actions()));
        },
        onHidden(instance) {
            instance.destroy();
            popover_instances.all_messages = undefined;
        },
    });
}

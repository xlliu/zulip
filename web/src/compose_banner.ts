import $ from "jquery";

import render_compose_banner from "../templates/compose_banner/compose_banner.hbs";
import render_stream_does_not_exist_error from "../templates/compose_banner/stream_does_not_exist_error.hbs";

export let scroll_to_message_banner_message_id: number | null = null;
export function set_scroll_to_message_banner_message_id(val: number | null): void {
    scroll_to_message_banner_message_id = val;
}

// banner types
export const WARNING = "warning";
export const ERROR = "error";

const MESSAGE_SENT_CLASSNAMES = {
    sent_scroll_to_view: "sent_scroll_to_view",
    narrow_to_recipient: "narrow_to_recipient",
};

export const CLASSNAMES = {
    ...MESSAGE_SENT_CLASSNAMES,
    // warnings
    topic_resolved: "topic_resolved",
    recipient_not_subscribed: "recipient_not_subscribed",
    wildcard_warning: "wildcard_warning",
    private_stream_warning: "private_stream_warning",
    // errors
    wildcards_not_allowed: "wildcards_not_allowed",
    subscription_error: "subscription_error",
    stream_does_not_exist: "stream_does_not_exist",
    missing_stream: "missing_stream",
    no_post_permissions: "no_post_permissions",
    private_messages_disabled: "private_messages_disabled",
    missing_private_message_recipient: "missing_private_message_recipient",
    invalid_recipient: "invalid_recipient",
    invalid_recipients: "invalid_recipients",
    deactivated_user: "deactivated_user",
    message_too_long: "message_too_long",
    topic_missing: "topic_missing",
    zephyr_not_running: "zephyr_not_running",
    generic_compose_error: "generic_compose_error",
    user_not_subscribed: "user_not_subscribed",
};

export function clear_message_sent_banners(): void {
    for (const classname of Object.values(MESSAGE_SENT_CLASSNAMES)) {
        $(`#compose_banners .${CSS.escape(classname)}`).remove();
    }
    scroll_to_message_banner_message_id = null;
}

// TODO: Replace with compose_ui.hide_compose_spinner() when it is converted to ts.
function hide_compose_spinner(): void {
    $("#compose-send-button .loader").hide();
    $("#compose-send-button span").show();
    $("#compose-send-button").removeClass("disable-btn");
}

export function clear_errors(): void {
    $(`#compose_banners .${CSS.escape(ERROR)}`).remove();
}

export function clear_warnings(): void {
    $(`#compose_banners .${CSS.escape(WARNING)}`).remove();
}

export function show_error_message(message: string, classname: string, $bad_input?: JQuery): void {
    $(`#compose_banners .${CSS.escape(classname)}`).remove();

    const new_row = render_compose_banner({
        banner_type: ERROR,
        stream_id: null,
        topic_name: null,
        banner_text: message,
        button_text: null,
        classname,
    });
    const $compose_banner_area = $("#compose_banners");
    $compose_banner_area.append(new_row);

    hide_compose_spinner();

    if ($bad_input !== undefined) {
        $bad_input.trigger("focus").trigger("select");
    }
}

export function show_stream_does_not_exist_error(stream_name: string): void {
    // Remove any existing banners with this warning.
    $(`#compose_banners .${CSS.escape(CLASSNAMES.stream_does_not_exist)}`).remove();

    const new_row = render_stream_does_not_exist_error({
        banner_type: ERROR,
        stream_name,
        classname: CLASSNAMES.stream_does_not_exist,
    });
    const $compose_banner_area = $("#compose_banners");
    $compose_banner_area.append(new_row);
    hide_compose_spinner();
    $("#stream_message_recipient_stream").trigger("focus").trigger("select");
}

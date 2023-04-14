import $ from "jquery";
import _ from "lodash";

import render_recent_topic_row from "../templates/recent_topic_row.hbs";
import render_recent_topics_filters from "../templates/recent_topics_filters.hbs";
import render_recent_topics_body from "../templates/recent_topics_table.hbs";
import render_user_with_status_icon from "../templates/user_with_status_icon.hbs";

import * as blueslip from "./blueslip";
import * as buddy_data from "./buddy_data";
import * as compose_closed_ui from "./compose_closed_ui";
import * as hash_util from "./hash_util";
import {$t} from "./i18n";
import * as ListWidget from "./list_widget";
import * as loading from "./loading";
import {localstorage} from "./localstorage";
import * as message_store from "./message_store";
import * as message_util from "./message_util";
import * as message_view_header from "./message_view_header";
import * as muted_topics_ui from "./muted_topics_ui";
import * as muted_users from "./muted_users";
import * as narrow from "./narrow";
import * as narrow_state from "./narrow_state";
import * as navigate from "./navigate";
import {page_params} from "./page_params";
import * as people from "./people";
import * as pm_list from "./pm_list";
import * as popovers from "./popovers";
import * as recent_senders from "./recent_senders";
import {get, process_message, topics} from "./recent_topics_data";
import {
    get_key_from_message,
    get_topic_key,
    is_in_focus,
    is_visible,
    set_visible,
} from "./recent_topics_util";
import * as search from "./search";
import * as stream_data from "./stream_data";
import * as stream_list from "./stream_list";
import * as sub_store from "./sub_store";
import * as timerender from "./timerender";
import * as top_left_corner from "./top_left_corner";
import * as ui from "./ui";
import * as ui_util from "./ui_util";
import * as unread from "./unread";
import * as unread_ops from "./unread_ops";
import * as unread_ui from "./unread_ui";
import * as user_status from "./user_status";
import * as user_topics from "./user_topics";

let topics_widget;
// Sets the number of avatars to display.
// Rest of the avatars, if present, are displayed as {+x}
const MAX_AVATAR = 4;
const MAX_EXTRA_SENDERS = 10;

// Use this to set the focused element.
//
// We set it's value to `table` in case the
// focus in one of the table rows, since the
// table rows are constantly updated and tracking
// the selected element in them would be tedious via
// jquery.
//
// So, we use table as a grid system and
// track the coordinates of the focus element via
// `row_focus` and `col_focus`.
export let $current_focus_elem = "table";

// If user clicks a topic in recent topics, then
// we store that topic here so that we can restore focus
// to that topic when user revisits.
let last_visited_topic = "";
let row_focus = 0;
// Start focus on the topic column, so Down+Enter works to visit a topic.
let col_focus = 1;

export const COLUMNS = {
    stream: 0,
    topic: 1,
    read: 2,
    mute: 3,
};

// The number of selectable actions in a recent_topics.  Used to
// implement wraparound of elements with the right/left keys.  Must be
// increased when we add new actions, or rethought if we add optional
// actions that only appear in some rows.
const MAX_SELECTABLE_TOPIC_COLS = 4;
const MAX_SELECTABLE_PM_COLS = 3;

// we use localstorage to persist the recent topic filters
const ls_key = "recent_topic_filters";
const ls = localstorage();

let filters = new Set();

const recent_conversation_key_prefix = "recent_conversation:";

export function clear_for_tests() {
    filters.clear();
    topics.clear();
    topics_widget = undefined;
}

export function save_filters() {
    ls.set(ls_key, [...filters]);
}

export function set_default_focus() {
    // If at any point we are confused about the currently
    // focused element, we switch focus to search.
    $current_focus_elem = $("#recent_topics_search");
    $current_focus_elem.trigger("focus");
    compose_closed_ui.set_standard_text_for_reply_button();
}

function get_min_load_count(already_rendered_count, load_count) {
    const extra_rows_for_viewing_pleasure = 15;
    if (row_focus > already_rendered_count + load_count) {
        return row_focus + extra_rows_for_viewing_pleasure - already_rendered_count;
    }
    return load_count;
}

function is_table_focused() {
    return $current_focus_elem === "table";
}

function get_row_type(row) {
    // Return "private" or "stream"
    // We use CSS method for finding row type until topics_widget gets initialized.
    if (!topics_widget) {
        const $topic_rows = $("#recent_topics_table table tbody tr");
        const $topic_row = $topic_rows.eq(row);
        const is_private = $topic_row.attr("data-private");
        if (is_private) {
            return "private";
        }
        return "stream";
    }

    const current_list = topics_widget.get_current_list();
    const current_row = current_list[row];
    return current_row.type;
}

function get_max_selectable_cols(row) {
    // returns maximum number of columns in stream message or private message row.
    const type = get_row_type(row);
    if (type === "private") {
        return MAX_SELECTABLE_PM_COLS;
    }
    return MAX_SELECTABLE_TOPIC_COLS;
}

function set_table_focus(row, col, using_keyboard) {
    const $topic_rows = $("#recent_topics_table table tbody tr");
    if ($topic_rows.length === 0 || row < 0 || row >= $topic_rows.length) {
        row_focus = 0;
        // return focus back to filters if we cannot focus on the table.
        set_default_focus();
        return true;
    }

    const unread = has_unread(row);
    if (col === 2 && !unread) {
        col = 1;
        col_focus = 1;
    }
    const type = get_row_type(row);
    if (col === 3 && type === "private") {
        col = unread ? 2 : 1;
        col_focus = col;
    }

    const $topic_row = $topic_rows.eq(row);
    // We need to allow table to render first before setting focus.
    setTimeout(
        () => $topic_row.find(".recent_topics_focusable").eq(col).children().trigger("focus"),
        0,
    );
    $current_focus_elem = "table";

    if (using_keyboard) {
        const scroll_element = document.querySelector(
            "#recent_topics_table .table_fix_head .simplebar-content-wrapper",
        );
        const half_height_of_visible_area = scroll_element.offsetHeight / 2;
        const topic_offset = topic_offset_to_visible_area($topic_row);

        if (topic_offset === "above") {
            scroll_element.scrollBy({top: -1 * half_height_of_visible_area});
        } else if (topic_offset === "below") {
            scroll_element.scrollBy({top: half_height_of_visible_area});
        }
    }

    // TODO: This fake "message" object is designed to allow using the
    // get_recipient_label helper inside compose_closed_ui. Surely
    // there's a more readable way to write this code.
    let message;
    if (type === "private") {
        message = {
            display_reply_to: $topic_row.find(".recent_topic_name a").text(),
        };
    } else {
        message = {
            stream: $topic_row.find(".recent_topic_stream a").text(),
            topic: $topic_row.find(".recent_topic_name a").text(),
        };
    }
    compose_closed_ui.update_reply_recipient_label(message);
    return true;
}

export function get_focused_row_message() {
    if (is_table_focused()) {
        const $topic_rows = $("#recent_topics_table table tbody tr");
        if ($topic_rows.length === 0) {
            return undefined;
        }

        const $topic_row = $topic_rows.eq(row_focus);
        const conversation_id = $topic_row.attr("id").slice(recent_conversation_key_prefix.length);
        const topic_last_msg_id = topics.get(conversation_id).last_msg_id;
        return message_store.get(topic_last_msg_id);
    }
    return undefined;
}

export function revive_current_focus() {
    // After re-render, the current_focus_elem is no longer linked
    // to the focused element, this function attempts to revive the
    // link and focus to the element prior to the rerender.

    // We try to avoid setting focus when user
    // is not focused on recent topics.
    if (!is_in_focus()) {
        return false;
    }

    if (!$current_focus_elem) {
        set_default_focus();
        return false;
    }

    if (is_table_focused()) {
        if (last_visited_topic) {
            // If the only message in the topic was deleted,
            // then the topic will not be in recent topics data.
            if (topics.get(last_visited_topic) !== undefined) {
                const topic_last_msg_id = topics.get(last_visited_topic).last_msg_id;
                const current_list = topics_widget.get_current_list();
                const last_visited_topic_index = current_list.findIndex(
                    (topic) => topic.last_msg_id === topic_last_msg_id,
                );
                if (last_visited_topic_index >= 0) {
                    row_focus = last_visited_topic_index;
                }
            }
            last_visited_topic = "";
        }
        set_table_focus(row_focus, col_focus);
        return true;
    }

    const filter_button = $current_focus_elem.data("filter");
    if (!filter_button) {
        set_default_focus();
    } else {
        $current_focus_elem = $("#recent_topics_filter_buttons").find(
            `[data-filter='${CSS.escape(filter_button)}']`,
        );
        $current_focus_elem.trigger("focus");
    }
    return true;
}

export function show_loading_indicator() {
    loading.make_indicator($("#recent_topics_loading_messages_indicator"));
}

export function hide_loading_indicator() {
    $("#recent_topics_bottom_whitespace").hide();
    loading.destroy_indicator($("#recent_topics_loading_messages_indicator"), {
        abs_positioned: false,
    });
    // Show empty table text if there are no messages fetched.
    $("#recent_topics_table tbody").addClass("required-text");
}

export function process_messages(messages) {
    // While this is inexpensive and handles all the cases itself,
    // the UX can be bad if user wants to scroll down the list as
    // the UI will be returned to the beginning of the list on every
    // update.
    let conversation_data_updated = false;
    if (messages.length > 0) {
        for (const msg of messages) {
            if (process_message(msg)) {
                conversation_data_updated = true;
            }
        }
    }

    // Only rerender if conversation data actually changed.
    if (conversation_data_updated) {
        complete_rerender();
    }
}

function message_to_conversation_unread_count(msg) {
    if (msg.type === "private") {
        return unread.num_unread_for_user_ids_string(msg.to_user_ids);
    }
    return unread.num_unread_for_topic(msg.stream_id, msg.topic);
}

export function get_pm_tooltip_data(user_ids_string) {
    const user_id = Number.parseInt(user_ids_string, 10);
    const person = people.get_by_user_id(user_id);

    if (person.is_bot) {
        const bot_owner = people.get_bot_owner_user(person);

        if (bot_owner) {
            const bot_owner_name = $t(
                {defaultMessage: "Owner: {name}"},
                {name: bot_owner.full_name},
            );

            return {
                first_line: person.full_name,
                second_line: bot_owner_name,
            };
        }

        // Bot does not have an owner.
        return {
            first_line: person.full_name,
            second_line: "",
            third_line: "",
        };
    }

    const last_seen = buddy_data.user_last_seen_time_status(user_id);

    // Users does not have a status.
    return {
        first_line: last_seen,
        second_line: "",
        third_line: "",
    };
}

function format_conversation(conversation_data) {
    const context = {};
    const last_msg = message_store.get(conversation_data.last_msg_id);
    const time = new Date(last_msg.timestamp * 1000);
    const type = last_msg.type;
    context.full_last_msg_date_time = timerender.get_full_datetime(time);
    context.conversation_key = get_key_from_message(last_msg);
    context.unread_count = message_to_conversation_unread_count(last_msg);
    context.last_msg_time = timerender.relative_time_string_from_date(time);
    context.is_private = last_msg.type === "private";
    let all_senders;
    let senders;
    let displayed_other_senders;
    let extra_sender_ids;

    if (type === "stream") {
        const stream_info = sub_store.get(last_msg.stream_id);

        // Stream info
        context.stream_id = last_msg.stream_id;
        context.stream = last_msg.stream;
        context.stream_color = stream_info.color;
        context.stream_url = hash_util.by_stream_url(context.stream_id);
        context.invite_only = stream_info.invite_only;
        context.is_web_public = stream_info.is_web_public;
        // Topic info
        context.topic = last_msg.topic;
        context.topic_url = hash_util.by_stream_topic_url(context.stream_id, context.topic);

        // We hide the row according to filters or if it's muted.
        // We only supply the data to the topic rows and let jquery
        // display / hide them according to filters instead of
        // doing complete re-render.
        context.topic_muted = Boolean(user_topics.is_topic_muted(context.stream_id, context.topic));
        context.mention_in_unread = unread.topic_has_any_unread_mentions(
            context.stream_id,
            context.topic,
        );

        // Since the css for displaying senders in reverse order is much simpler,
        // we provide our handlebars with senders in opposite order.
        // Display in most recent sender first order.
        all_senders = recent_senders
            .get_topic_recent_senders(context.stream_id, context.topic)
            .reverse();
        senders = all_senders.slice(-MAX_AVATAR);

        // Collect extra sender fullname for tooltip
        extra_sender_ids = all_senders.slice(0, -MAX_AVATAR);
        displayed_other_senders = extra_sender_ids.slice(-MAX_EXTRA_SENDERS);
    } else if (type === "private") {
        // Private message info
        context.user_ids_string = last_msg.to_user_ids;
        context.rendered_pm_with = last_msg.display_recipient
            .filter(
                (recipient) =>
                    !people.is_my_user_id(recipient.id) || last_msg.display_recipient.length === 1,
            )
            .map((user) =>
                render_user_with_status_icon({
                    name: people.get_display_full_name(user.id),
                    status_emoji_info: user_status.get_status_emoji(user.id),
                }),
            )
            .sort()
            .join(", ");
        context.recipient_id = last_msg.recipient_id;
        context.pm_url = last_msg.pm_with_url;
        context.is_group = last_msg.display_recipient.length > 2;

        if (!context.is_group) {
            const user_id = Number.parseInt(last_msg.to_user_ids, 10);
            const user = people.get_by_user_id(user_id);
            if (user.is_bot) {
                // Bots do not have status emoji, and are modeled as
                // always present.
                context.user_circle_class = "user_circle_green";
            } else {
                context.user_circle_class = buddy_data.get_user_circle_class(user_id);
            }
        }

        // Since the css for displaying senders in reverse order is much simpler,
        // we provide our handlebars with senders in opposite order.
        // Display in most recent sender first order.
        // To match the behavior for streams, we display the set of users who've actually
        // participated, with the most recent participants first. It could make sense to
        // display the other recipients on the PM conversation with different styling,
        // but it's important to not destroy the information of "who's actually talked".
        all_senders = recent_senders
            .get_pm_recent_senders(context.user_ids_string)
            .participants.reverse();
        senders = all_senders.slice(-MAX_AVATAR);
        // Collect extra senders fullname for tooltip.
        extra_sender_ids = all_senders.slice(0, -MAX_AVATAR);
        displayed_other_senders = extra_sender_ids.slice(-MAX_EXTRA_SENDERS);
    }

    context.senders = people.sender_info_for_recent_topics_row(senders);
    context.other_senders_count = Math.max(0, all_senders.length - MAX_AVATAR);
    extra_sender_ids = all_senders.slice(0, -MAX_AVATAR);
    const displayed_other_names = people.get_display_full_names(displayed_other_senders.reverse());

    if (extra_sender_ids.length > MAX_EXTRA_SENDERS) {
        // We display only 10 extra senders in tooltips,
        // and just display remaining number of senders.
        const remaining_senders = extra_sender_ids.length - MAX_EXTRA_SENDERS;
        // Pluralization syntax from:
        // https://formatjs.io/docs/core-concepts/icu-syntax/#plural-format
        displayed_other_names.push(
            $t(
                {
                    defaultMessage:
                        "and {remaining_senders, plural, one {1 other} other {# others}}.",
                },
                {remaining_senders},
            ),
        );
    }
    context.other_sender_names_html = displayed_other_names
        .map((name) => _.escape(name))
        .join("<br />");
    context.last_msg_url = hash_util.by_conversation_and_time_url(last_msg);

    return context;
}

function get_topic_row(topic_data) {
    const msg = message_store.get(topic_data.last_msg_id);
    const topic_key = get_key_from_message(msg);
    return $(`#${CSS.escape(recent_conversation_key_prefix + topic_key)}`);
}

export function process_topic_edit(old_stream_id, old_topic, new_topic, new_stream_id) {
    // See `recent_senders.process_topic_edit` for
    // logic behind this and important notes on use of this function.
    topics.delete(get_topic_key(old_stream_id, old_topic));

    const old_topic_msgs = message_util.get_messages_in_topic(old_stream_id, old_topic);
    process_messages(old_topic_msgs);

    new_stream_id = new_stream_id || old_stream_id;
    const new_topic_msgs = message_util.get_messages_in_topic(new_stream_id, new_topic);
    process_messages(new_topic_msgs);
}

export function topic_in_search_results(keyword, stream, topic) {
    if (keyword === "") {
        return true;
    }
    const text = (stream + " " + topic).toLowerCase();
    const search_words = keyword.toLowerCase().split(/\s+/);
    return search_words.every((word) => text.includes(word));
}

export function update_topics_of_deleted_message_ids(message_ids) {
    const topics_to_rerender = message_util.get_topics_for_message_ids(message_ids);

    for (const [stream_id, topic] of topics_to_rerender.values()) {
        topics.delete(get_topic_key(stream_id, topic));
        const msgs = message_util.get_messages_in_topic(stream_id, topic);
        process_messages(msgs);
    }
}

export function filters_should_hide_topic(topic_data) {
    const msg = message_store.get(topic_data.last_msg_id);
    const sub = sub_store.get(msg.stream_id);

    if ((sub === undefined || !sub.subscribed) && topic_data.type === "stream") {
        // Never try to process deactivated & unsubscribed stream msgs.
        return true;
    }

    if (filters.has("unread")) {
        const unread_count = message_to_conversation_unread_count(msg);
        if (unread_count === 0) {
            return true;
        }
    }

    if (!topic_data.participated && filters.has("participated")) {
        return true;
    }

    if (!filters.has("include_muted") && topic_data.type === "stream") {
        const topic_muted = Boolean(user_topics.is_topic_muted(msg.stream_id, msg.topic));
        const stream_muted = stream_data.is_muted(msg.stream_id);
        if (topic_muted || stream_muted) {
            return true;
        }
    }

    if (!filters.has("include_private") && topic_data.type === "private") {
        return true;
    }

    if (filters.has("include_private") && topic_data.type === "private") {
        const recipients = people.split_to_ints(msg.to_user_ids);

        if (recipients.every((id) => muted_users.is_user_muted(id))) {
            return true;
        }
    }

    const search_keyword = $("#recent_topics_search").val();
    if (!topic_in_search_results(search_keyword, msg.stream, msg.topic)) {
        return true;
    }

    return false;
}

export function inplace_rerender(topic_key) {
    if (!is_visible()) {
        return false;
    }
    if (!topics.has(topic_key)) {
        return false;
    }

    const topic_data = topics.get(topic_key);
    const topic_row = get_topic_row(topic_data);
    // We cannot rely on `topic_widget.meta.filtered_list` to know
    // if a topic is rendered since the `filtered_list` might have
    // already been updated via other calls.
    const is_topic_rendered = topic_row.length;
    // Resorting the topics_widget is important for the case where we
    // are rerendering because of message editing or new messages
    // arriving, since those operations often change the sort key.
    topics_widget.filter_and_sort();
    const current_topics_list = topics_widget.get_current_list();
    if (is_topic_rendered && filters_should_hide_topic(topic_data)) {
        // Since the row needs to be removed from DOM, we need to adjust `row_focus`
        // if the row being removed is focused and is the last row in the list.
        // This prevents the row_focus either being reset to the first row or
        // middle of the visible table rows.
        // We need to get the current focused row details from DOM since we cannot
        // rely on `current_topics_list` since it has already been updated and row
        // doesn't exist inside it.
        const row_is_focused = get_focused_row_message()?.id === topic_data.last_msg_id;
        if (row_is_focused && row_focus >= current_topics_list.length) {
            row_focus = current_topics_list.length - 1;
        }
        topics_widget.remove_rendered_row(topic_row);
    } else if (!is_topic_rendered && filters_should_hide_topic(topic_data)) {
        // In case `topic_row` is not present, our job is already done here
        // since it has not been rendered yet and we already removed it from
        // the filtered list in `topic_widget`. So, it won't be displayed in
        // the future too.
    } else if (is_topic_rendered && !filters_should_hide_topic(topic_data)) {
        // Only a re-render is required in this case.
        topics_widget.render_item(topic_data);
    } else {
        // Final case: !is_topic_rendered && !filters_should_hide_topic(topic_data).
        topics_widget.insert_rendered_row(topic_data);
    }
    setTimeout(revive_current_focus, 0);
    return true;
}

export function update_topic_is_muted(stream_id, topic) {
    const key = get_topic_key(stream_id, topic);
    if (!topics.has(key)) {
        // we receive mute request for a topic we are
        // not tracking currently
        return false;
    }

    inplace_rerender(key);
    return true;
}

export function update_topic_unread_count(message) {
    const topic_key = get_key_from_message(message);
    inplace_rerender(topic_key);
}

export function set_filter(filter) {
    // This function updates the `filters` variable
    // after user clicks on one of the filter buttons
    // based on `btn-recent-selected` class and current
    // set `filters`.

    // Get the button which was clicked.
    const $filter_elem = $("#recent_topics_filter_buttons").find(
        `[data-filter="${CSS.escape(filter)}"]`,
    );

    // If user clicks `All`, we clear all filters.
    if (filter === "all" && filters.size !== 0) {
        filters = new Set();
        // If the button was already selected, remove the filter.
    } else if ($filter_elem.hasClass("btn-recent-selected")) {
        filters.delete(filter);
        // If the button was not selected, we add the filter.
    } else {
        filters.add(filter);
    }

    save_filters();
}

function show_selected_filters() {
    // Add `btn-selected-filter` to the buttons to show
    // which filters are applied.
    if (filters.size === 0) {
        $("#recent_topics_filter_buttons")
            .find('[data-filter="all"]')
            .addClass("btn-recent-selected")
            .attr("aria-checked", "true");
    } else {
        for (const filter of filters) {
            $("#recent_topics_filter_buttons")
                .find(`[data-filter="${CSS.escape(filter)}"]`)
                .addClass("btn-recent-selected")
                .attr("aria-checked", "true");
        }
    }
}

export function update_filters_view() {
    const rendered_filters = render_recent_topics_filters({
        filter_participated: filters.has("participated"),
        filter_unread: filters.has("unread"),
        filter_muted: filters.has("include_muted"),
        filter_pm: filters.has("include_private"),
        is_spectator: page_params.is_spectator,
    });
    $("#recent_filters_group").html(rendered_filters);
    show_selected_filters();

    topics_widget.hard_redraw();
}

function sort_comparator(a, b) {
    // compares strings in lowercase and returns -1, 0, 1
    if (a.toLowerCase() > b.toLowerCase()) {
        return 1;
    } else if (a.toLowerCase() === b.toLowerCase()) {
        return 0;
    }
    return -1;
}

function stream_sort(a, b) {
    if (a.type === b.type) {
        const a_msg = message_store.get(a.last_msg_id);
        const b_msg = message_store.get(b.last_msg_id);

        if (a.type === "stream") {
            return sort_comparator(a_msg.stream, b_msg.stream);
        }
        return sort_comparator(a_msg.display_reply_to, b_msg.display_reply_to);
    }
    // if type is not same sort between "private" and "stream"
    return sort_comparator(a.type, b.type);
}

function topic_sort_key(conversation_data) {
    const message = message_store.get(conversation_data.last_msg_id);
    if (message.type === "private") {
        return message.display_reply_to;
    }
    return message.topic;
}

function topic_sort(a, b) {
    return sort_comparator(topic_sort_key(a), topic_sort_key(b));
}

function topic_offset_to_visible_area(topic_row) {
    const $topic_row = $(topic_row);
    if ($topic_row.length === 0) {
        // TODO: There is a possibility of topic_row being undefined here
        // which logically doesn't makes sense. Find out the case and
        // document it here.
        // We return undefined here since we don't know anything about the
        // topic and the callers will take care of undefined being returned.
        return undefined;
    }
    const $scroll_container = $("#recent_topics_table .table_fix_head");
    const thead_height = 30;
    const under_closed_compose_region_height = 50;

    const scroll_container_top = $scroll_container.offset().top + thead_height;
    const scroll_container_bottom =
        scroll_container_top + $scroll_container.height() - under_closed_compose_region_height;

    const topic_row_top = $topic_row.offset().top;
    const topic_row_bottom = topic_row_top + $topic_row.height();

    // Topic is above the visible scroll region.
    if (topic_row_top < scroll_container_top) {
        return "above";
        // Topic is below the visible scroll region.
    } else if (topic_row_bottom > scroll_container_bottom) {
        return "below";
    }

    // Topic is visible
    return "visible";
}

function set_focus_to_element_in_center() {
    const table_wrapper_element = document.querySelector("#recent_topics_table .table_fix_head");
    const $topic_rows = $("#recent_topics_table table tbody tr");

    if (row_focus > $topic_rows.length) {
        // User used a filter which reduced
        // the number of visible rows.
        return;
    }
    let $topic_row = $topic_rows.eq(row_focus);
    const topic_offset = topic_offset_to_visible_area($topic_row);
    if (topic_offset === undefined) {
        // We don't need to return here since technically topic_offset is not visible.
        blueslip.error(`Unable to get topic from row number ${row_focus}.`);
    }

    if (topic_offset !== "visible") {
        // Get the element at the center of the table.
        const position = table_wrapper_element.getBoundingClientRect();
        const topic_center_x = (position.left + position.right) / 2;
        const topic_center_y = (position.top + position.bottom) / 2;

        $topic_row = $(document.elementFromPoint(topic_center_x, topic_center_y)).closest("tr");

        row_focus = $topic_rows.index($topic_row);
        set_table_focus(row_focus, col_focus);
    }
}

function is_scroll_position_for_render(scroll_container) {
    const table_bottom_margin = 100; // Extra margin at the bottom of table.
    const table_row_height = 50;
    return (
        scroll_container.scrollTop +
            scroll_container.clientHeight +
            table_bottom_margin +
            table_row_height >
        scroll_container.scrollHeight
    );
}

export function complete_rerender() {
    if (!is_visible()) {
        return;
    }

    // Show topics list
    const mapped_topic_values = [...get().values()];

    if (topics_widget) {
        topics_widget.replace_list_data(mapped_topic_values);
        return;
    }

    const rendered_body = render_recent_topics_body({
        filter_participated: filters.has("participated"),
        filter_unread: filters.has("unread"),
        filter_muted: filters.has("include_muted"),
        filter_pm: filters.has("include_private"),
        search_val: $("#recent_topics_search").val() || "",
        is_spectator: page_params.is_spectator,
    });
    $("#recent_topics_table").html(rendered_body);

    // `show_selected_filters` needs to be called after the Recent
    // Conversations view has been added to the DOM, to ensure that filters
    // have the correct classes (checked or not) if Recent Conversations
    // was not the first view loaded in the app.
    show_selected_filters();

    const $container = $("#recent_topics_table table tbody");
    $container.empty();
    topics_widget = ListWidget.create($container, mapped_topic_values, {
        name: "recent_topics_table",
        $parent_container: $("#recent_topics_table"),
        modifier(item) {
            return render_recent_topic_row(format_conversation(item));
        },
        filter: {
            // We use update_filters_view & filters_should_hide_topic to do all the
            // filtering for us, which is called using click_handlers.
            predicate(topic_data) {
                return !filters_should_hide_topic(topic_data);
            },
        },
        sort_fields: {
            stream_sort,
            topic_sort,
        },
        html_selector: get_topic_row,
        $simplebar_container: $("#recent_topics_table .table_fix_head"),
        callback_after_render: () => setTimeout(revive_current_focus, 0),
        is_scroll_position_for_render,
        post_scroll__pre_render_callback: set_focus_to_element_in_center,
        get_min_load_count,
    });
}

export function show() {
    if (narrow.has_shown_message_list_view) {
        narrow.save_pre_narrow_offset_for_reload();
    }

    if (is_visible()) {
        // If we're already visible, E.g. because the user hit Esc
        // while already in the recent topics view, do nothing.
        return;
    }
    // Hide selected elements in the left sidebar.
    top_left_corner.narrow_to_recent_topics();
    stream_list.handle_narrow_deactivated();

    // Hide "middle-column" which has html for rendering
    // a messages narrow. We hide it and show recent topics.
    $("#message_feed_container").hide();
    $("#recent_topics_view").show();
    set_visible(true);
    $(".header").css("padding-bottom", "0px");

    unread_ui.hide_mark_as_read_turned_off_banner();

    // We want to show `new stream message` instead of
    // `new topic`, which we are already doing in this
    // function. So, we reuse it here.
    compose_closed_ui.update_buttons_for_recent_topics();

    narrow_state.reset_current_filter();
    narrow.update_narrow_title(narrow_state.filter());
    message_view_header.render_title_area();
    narrow.handle_middle_pane_transition();
    pm_list.handle_narrow_deactivated();
    search.clear_search_form();

    complete_rerender();
}

function filter_buttons() {
    return $("#recent_filters_group").children();
}

export function hide() {
    // On firefox (and flaky on other browsers), focus
    // remains on the focused element even after it is hidden. We
    // forcefully blur it so that focus returns to the visible
    // focused element.
    const $focused_element = $(document.activeElement);
    if ($("#recent_topics_view").has($focused_element)) {
        $focused_element.trigger("blur");
    }

    $("#message_feed_container").show();
    $("#recent_topics_view").hide();
    set_visible(false);

    $(".header").css("padding-bottom", "10px");

    // This solves a bug with message_view_header
    // being broken sometimes when we narrow
    // to a filter and back to recent topics
    // before it completely re-rerenders.
    message_view_header.render_title_area();

    // This makes sure user lands on the selected message
    // and not always at the top of the narrow.
    navigate.plan_scroll_to_selected();
}

function is_focus_at_last_table_row() {
    return row_focus >= topics_widget.get_current_list().length - 1;
}

function has_unread(row) {
    const last_msg_id = topics_widget.get_current_list()[row].last_msg_id;
    const last_msg = message_store.get(last_msg_id);
    if (last_msg.type === "stream") {
        return unread.num_unread_for_topic(last_msg.stream_id, last_msg.topic) > 0;
    }
    return unread.num_unread_for_user_ids_string(last_msg.to_user_ids) > 0;
}

export function focus_clicked_element(topic_row_index, col, topic_key) {
    $current_focus_elem = "table";
    col_focus = col;
    row_focus = topic_row_index;

    if (col === COLUMNS.topic) {
        last_visited_topic = topic_key;
    }
    // Set compose_closed_ui reply button text.  The rest of the table
    // focus logic should be a noop.
    set_table_focus(row_focus, col_focus);
}

function left_arrow_navigation(row, col) {
    const type = get_row_type(row);

    if (type === "stream" && col === MAX_SELECTABLE_TOPIC_COLS - 1 && !has_unread(row)) {
        col_focus -= 1;
    }

    col_focus -= 1;
    if (col_focus < 0) {
        col_focus = get_max_selectable_cols(row) - 1;
    }
}

function right_arrow_navigation(row, col) {
    const type = get_row_type(row);

    if (type === "stream" && col === 1 && !has_unread(row)) {
        col_focus += 1;
    }

    col_focus += 1;
    if (col_focus >= get_max_selectable_cols(row)) {
        col_focus = 0;
    }
}

function up_arrow_navigation(row, col) {
    row_focus -= 1;
    if (row_focus < 0) {
        return;
    }
    const type = get_row_type(row);

    if (type === "stream" && col === 2 && row - 1 >= 0 && !has_unread(row - 1)) {
        col_focus = 1;
    }
}

function down_arrow_navigation() {
    row_focus += 1;
}

function get_page_up_down_delta() {
    const table_height = $("#recent_topics_table .table_fix_head").height();
    const table_header_height = $("#recent_topics_table table thead").height();
    const compose_box_height = $("#compose").height();
    // One usually wants PageDown to move what had been the bottom row
    // to now be at the top, so one can be confident one will see
    // every row using it. This offset helps achieve that goal.
    //
    // See navigate.amount_to_paginate for similar logic in the message feed.
    const scrolling_reduction_to_maintain_context = 75;

    const delta =
        table_height -
        table_header_height -
        compose_box_height -
        scrolling_reduction_to_maintain_context;
    return delta;
}

function page_up_navigation() {
    const $scroll_container = ui.get_scroll_element($("#recent_topics_table .table_fix_head"));
    const delta = get_page_up_down_delta();
    const new_scrollTop = $scroll_container.scrollTop() - delta;
    if (new_scrollTop <= 0) {
        row_focus = 0;
    }
    $scroll_container.scrollTop(new_scrollTop);
    set_table_focus(row_focus, col_focus);
}

function page_down_navigation() {
    const $scroll_container = ui.get_scroll_element($("#recent_topics_table .table_fix_head"));
    const delta = get_page_up_down_delta();
    const new_scrollTop = $scroll_container.scrollTop() + delta;
    const table_height = $("#recent_topics_table .table_fix_head").height();
    if (new_scrollTop >= table_height) {
        row_focus = topics_widget.get_current_list().length - 1;
    }
    $scroll_container.scrollTop(new_scrollTop);
    set_table_focus(row_focus, col_focus);
}

function check_row_type_transition(row, col) {
    // This function checks if the row is transitioning
    // from type "Private messages" to "Stream" or vice versa.
    // This helps in setting the col_focus as maximum column
    // of both the type are different.
    if (row < 0) {
        return false;
    }
    const max_col = get_max_selectable_cols(row);
    if (col > max_col - 1) {
        return true;
    }
    return false;
}

export function change_focused_element($elt, input_key) {
    // Called from hotkeys.js; like all logic in that module,
    // returning true will cause the caller to do
    // preventDefault/stopPropagation; false will let the browser
    // handle the key.

    if ($elt.attr("id") === "recent_topics_search") {
        // Since the search box a text area, we want the browser to handle
        // Left/Right and selection within the widget; but if the user
        // arrows off the edges, we should move focus to the adjacent widgets..
        const textInput = $("#recent_topics_search").get(0);
        const start = textInput.selectionStart;
        const end = textInput.selectionEnd;
        const text_length = textInput.value.length;
        let is_selected = false;
        if (end - start > 0) {
            is_selected = true;
        }

        switch (input_key) {
            //  Allow browser to handle all
            //  character keypresses.
            case "vim_left":
            case "vim_right":
            case "vim_down":
            case "vim_up":
            case "open_recent_topics":
                return false;
            case "shift_tab":
                $current_focus_elem = filter_buttons().last();
                break;
            case "left_arrow":
                if (start !== 0 || is_selected) {
                    return false;
                }
                $current_focus_elem = filter_buttons().last();
                break;
            case "tab":
                $current_focus_elem = filter_buttons().first();
                break;
            case "right_arrow":
                if (end !== text_length || is_selected) {
                    return false;
                }
                $current_focus_elem = filter_buttons().first();
                break;
            case "down_arrow":
                set_table_focus(row_focus, col_focus);
                return true;
            case "click":
                // Note: current_focus_elem can be different here, so we just
                // set current_focus_elem to the input box, we don't want .trigger("focus") on
                // it since it is already focused.
                // We only do this for search because we don't want the focus to
                // go away from the input box when `revive_current_focus` is called
                // on rerender when user is typing.
                $current_focus_elem = $("#recent_topics_search");
                compose_closed_ui.set_standard_text_for_reply_button();
                return true;
            case "escape":
                if (is_table_focused()) {
                    return false;
                }
                set_table_focus(row_focus, col_focus);
                return true;
        }
    } else if ($elt.hasClass("btn-recent-filters")) {
        switch (input_key) {
            case "click":
                $current_focus_elem = $elt;
                return true;
            case "shift_tab":
            case "vim_left":
            case "left_arrow":
                if (filter_buttons().first()[0] === $elt[0]) {
                    $current_focus_elem = $("#recent_topics_search");
                } else {
                    $current_focus_elem = $elt.prev();
                }
                break;
            case "tab":
            case "vim_right":
            case "right_arrow":
                if (filter_buttons().last()[0] === $elt[0]) {
                    $current_focus_elem = $("#recent_topics_search");
                } else {
                    $current_focus_elem = $elt.next();
                }
                break;
            case "vim_down":
            case "down_arrow":
                set_table_focus(row_focus, col_focus);
                return true;
            case "escape":
                if (is_table_focused()) {
                    return false;
                }
                set_table_focus(row_focus, col_focus);
                return true;
        }
    } else if (is_table_focused()) {
        // Don't process hotkeys in table if there are no rows.
        if (!topics_widget || topics_widget.get_current_list().length === 0) {
            return true;
        }

        // For arrowing around the table of topics, we implement left/right
        // wraparound.  Going off the top or the bottom takes one
        // to the navigation at the top (see set_table_focus).
        switch (input_key) {
            case "escape":
                return false;
            case "open_recent_topics":
                set_default_focus();
                return true;
            case "shift_tab":
            case "vim_left":
            case "left_arrow":
                left_arrow_navigation(row_focus, col_focus);
                break;
            case "tab":
            case "vim_right":
            case "right_arrow":
                right_arrow_navigation(row_focus, col_focus);
                break;
            case "down_arrow":
            case "vim_down":
                // We stop user at last table row
                // so that user doesn't end up in
                // input box where it is impossible to
                // get out of using vim_up / vim_down
                // keys. This also blocks the user from
                // having `jjjj` typed in the input box
                // when continuously pressing `j`.
                if (is_focus_at_last_table_row()) {
                    return true;
                }
                down_arrow_navigation();
                break;
            case "vim_up":
                // See comment on vim_down.
                // Similarly, blocks the user from
                // having `kkkk` typed in the input box
                // when continuously pressing `k`.
                if (row_focus === 0) {
                    return true;
                }
                up_arrow_navigation(row_focus, col_focus);
                break;
            case "up_arrow":
                up_arrow_navigation(row_focus, col_focus);
                break;
            case "page_up":
                page_up_navigation();
                return true;
            case "page_down":
                page_down_navigation();
                return true;
        }

        if (check_row_type_transition(row_focus, col_focus)) {
            col_focus = get_max_selectable_cols(row_focus) - 1;
        }

        set_table_focus(row_focus, col_focus, true);
        return true;
    }
    if ($current_focus_elem && input_key !== "escape") {
        $current_focus_elem.trigger("focus");
        if ($current_focus_elem.hasClass("btn-recent-filters")) {
            compose_closed_ui.set_standard_text_for_reply_button();
        }
        return true;
    }

    return false;
}

export function initialize() {
    // load filters from local storage.
    if (!page_params.is_spectator) {
        // A user may have a stored filter and can log out
        // to see web public view. This ensures no filters are
        // selected for spectators.
        filters = new Set(ls.get(ls_key));
    }

    $("body").on("click", "#recent_topics_table .participant_profile", function (e) {
        const participant_user_id = Number.parseInt($(this).attr("data-user-id"), 10);
        e.stopPropagation();
        const user = people.get_by_user_id(participant_user_id);
        popovers.show_user_info_popover(this, user);
    });

    $("body").on("keydown", ".on_hover_topic_mute", ui_util.convert_enter_to_click);

    $("body").on("click", "#recent_topics_table .on_hover_topic_unmute", (e) => {
        e.stopPropagation();
        const $elt = $(e.target);
        const topic_row_index = $elt.closest("tr").index();
        focus_clicked_element(topic_row_index, COLUMNS.mute);
        muted_topics_ui.mute_or_unmute_topic($elt, false);
    });

    $("body").on("keydown", ".on_hover_topic_unmute", ui_util.convert_enter_to_click);

    $("body").on("click", "#recent_topics_table .on_hover_topic_mute", (e) => {
        e.stopPropagation();
        const $elt = $(e.target);
        const topic_row_index = $elt.closest("tr").index();
        focus_clicked_element(topic_row_index, COLUMNS.mute);
        muted_topics_ui.mute_or_unmute_topic($elt, true);
    });

    $("body").on("click", "#recent_topics_search", (e) => {
        e.stopPropagation();
        change_focused_element($(e.target), "click");
    });

    $("body").on("click", "#recent_topics_table .on_hover_topic_read", (e) => {
        e.stopPropagation();
        const $elt = $(e.currentTarget);
        const topic_row_index = $elt.closest("tr").index();
        focus_clicked_element(topic_row_index, COLUMNS.read);
        const user_ids_string = $elt.attr("data-user-ids-string");
        if (user_ids_string) {
            // PM row
            unread_ops.mark_pm_as_read(user_ids_string);
        } else {
            // Stream row
            const stream_id = Number.parseInt($elt.attr("data-stream-id"), 10);
            const topic = $elt.attr("data-topic-name");
            unread_ops.mark_topic_as_read(stream_id, topic);
        }
        // If `unread` filter is selected, the focused topic row gets removed
        // and we automatically move one row down.
        if (!filters.has("unread")) {
            change_focused_element($elt, "down_arrow");
        }
    });

    $("body").on("keydown", ".on_hover_topic_read", ui_util.convert_enter_to_click);

    $("body").on("click", ".btn-recent-filters", (e) => {
        e.stopPropagation();
        if (page_params.is_spectator) {
            // Filter buttons are disabled for spectator.
            return;
        }

        change_focused_element($(e.target), "click");
        set_filter(e.currentTarget.dataset.filter);
        update_filters_view();
        revive_current_focus();
    });

    $("body").on("click", "td.recent_topic_stream", (e) => {
        e.stopPropagation();
        const topic_row_index = $(e.target).closest("tr").index();
        focus_clicked_element(topic_row_index, COLUMNS.stream);
        window.location.href = $(e.currentTarget).find("a").attr("href");
    });

    $("body").on("click", "td.recent_topic_name", (e) => {
        e.stopPropagation();
        // The element's parent may re-render while it is being passed to
        // other functions, so, we get topic_key first.
        const $topic_row = $(e.target).closest("tr");
        const topic_key = $topic_row.attr("id").slice("recent_conversation:".length);
        const topic_row_index = $topic_row.index();
        focus_clicked_element(topic_row_index, COLUMNS.topic, topic_key);
        window.location.href = $(e.currentTarget).find("a").attr("href");
    });

    // Search for all table rows (this combines stream & topic names)
    $("body").on(
        "keyup",
        "#recent_topics_search",
        _.debounce(() => {
            update_filters_view();
            // Wait for user to go idle before initiating search.
        }, 300),
    );

    $("body").on("click", "#recent_topics_search_clear", (e) => {
        e.stopPropagation();
        $("#recent_topics_search").val("");
        update_filters_view();
    });
}

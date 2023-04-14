import {Filter} from "./filter";
import * as message_list from "./message_list";
import * as recent_topics_util from "./recent_topics_util";
import * as ui_util from "./ui_util";

export let home;
export let current;

export function set_current(msg_list) {
    current = msg_list;
}

export function all_rendered_message_lists() {
    const rendered_message_lists = [home];
    if (current !== home && !recent_topics_util.is_visible()) {
        rendered_message_lists.push(current);
    }
    return rendered_message_lists;
}

export function update_recipient_bar_background_color() {
    for (const msg_list of all_rendered_message_lists()) {
        msg_list.view.update_recipient_bar_background_color();
    }
}

export function initialize() {
    home = new message_list.MessageList({
        table_name: "zhome",
        filter: new Filter([{operator: "in", operand: "home"}]),
        excludes_muted_topics: true,
    });
    current = home;

    // For users with automatic color scheme, we need to detect change
    // in `prefers-color-scheme`as it changes based on time.
    ui_util.listener_for_preferred_color_scheme_change(update_recipient_bar_background_color);
}

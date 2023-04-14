import $ from "jquery";

import render_confirm_delete_user from "../templates/confirm_dialog/confirm_delete_user.hbs";
import render_change_user_group_info_modal from "../templates/user_group_settings/change_user_group_info_modal.hbs";
import render_user_group_settings from "../templates/user_group_settings/user_group_settings.hbs";

import * as blueslip from "./blueslip";
import * as browser_history from "./browser_history";
import * as channel from "./channel";
import * as components from "./components";
import * as confirm_dialog from "./confirm_dialog";
import * as dialog_widget from "./dialog_widget";
import * as hash_util from "./hash_util";
import {$t, $t_html} from "./i18n";
import * as overlays from "./overlays";
import {page_params} from "./page_params";
import * as people from "./people";
import * as settings_data from "./settings_data";
import * as settings_ui from "./settings_ui";
import * as ui from "./ui";
import * as ui_report from "./ui_report";
import * as user_group_edit_members from "./user_group_edit_members";
import * as user_group_ui_updates from "./user_group_ui_updates";
import * as user_groups from "./user_groups";
import * as user_group_settings_ui from "./user_groups_settings_ui";

export let toggler;
export let select_tab = "group_general_settings";

function setup_group_edit_hash(group) {
    const hash = hash_util.group_edit_url(group);
    browser_history.update(hash);
}

function get_user_group_id(target) {
    const $row = $(target).closest(".group-row, .user_group_settings_wrapper, .save-button");
    return Number.parseInt($row.attr("data-group-id"), 10);
}

function get_user_group_for_target(target) {
    const user_group_id = get_user_group_id(target);
    if (!user_group_id) {
        blueslip.error("Cannot find user group id for target");
        return undefined;
    }

    const group = user_groups.get_user_group_from_id(user_group_id);
    if (!group) {
        blueslip.error("get_user_group_for_target() failed id lookup: " + user_group_id);
        return undefined;
    }
    return group;
}

export function can_edit(group_id) {
    if (!settings_data.user_can_edit_user_groups()) {
        return false;
    }

    // Admins and moderators are allowed to edit user groups even if they
    // are not a member of that user group. Members can edit user groups
    // only if they belong to that group.
    if (page_params.is_admin || page_params.is_moderator) {
        return true;
    }

    return user_groups.is_direct_member_of(people.my_current_user_id(), group_id);
}

export function get_edit_container(group) {
    return $(
        `#groups_overlay .user_group_settings_wrapper[data-group-id='${CSS.escape(group.id)}']`,
    );
}

function show_membership_settings(group) {
    const $edit_container = get_edit_container(group);
    user_group_ui_updates.update_add_members_elements(group);

    const $member_container = $edit_container.find(".edit_members_for_user_group");
    user_group_edit_members.enable_member_management({
        group,
        $parent_container: $member_container,
    });
}

function enable_group_edit_settings(group) {
    if (!hash_util.is_editing_group(group.id)) {
        return;
    }
    const $edit_container = get_edit_container(group);
    $edit_container.find("#open_group_info_modal").show();
    $edit_container.find(".member-list .actions").show();
    user_group_ui_updates.update_add_members_elements(group);
}

function disable_group_edit_settings(group) {
    if (!hash_util.is_editing_group(group.id)) {
        return;
    }
    const $edit_container = get_edit_container(group);
    $edit_container.find("#open_group_info_modal").hide();
    $edit_container.find(".member-list .actions").hide();
    user_group_ui_updates.update_add_members_elements(group);
}

export function handle_member_edit_event(group_id) {
    if (!overlays.groups_open()) {
        return;
    }
    const group = user_groups.get_user_group_from_id(group_id);

    // update members list.
    const members = [...group.members];
    user_group_edit_members.update_member_list_widget(group_id, members);

    // update_settings buttons.
    if (can_edit(group_id)) {
        enable_group_edit_settings(group);
    } else {
        disable_group_edit_settings(group);
    }
}

export function update_settings_pane(group) {
    const $edit_container = get_edit_container(group);
    $edit_container.find(".group-name").text(group.name);
    $edit_container.find(".group-description").text(group.description);
}

export function show_settings_for(node) {
    const group = get_user_group_for_target(node);
    const html = render_user_group_settings({
        group,
        can_edit: can_edit(group.id),
    });

    ui.get_content_element($("#user_group_settings")).html(html);
    user_group_ui_updates.update_toggler_for_group_setting(group);

    $("#user_group_settings .tab-container").prepend(toggler.get());
    const $edit_container = get_edit_container(group);
    $(".nothing-selected").hide();

    $edit_container.show();
    show_membership_settings(group);
}

export function setup_group_settings(node) {
    toggler = components.toggle({
        child_wants_focus: true,
        values: [
            {label: $t({defaultMessage: "General"}), key: "group_general_settings"},
            {label: $t({defaultMessage: "Members"}), key: "group_member_settings"},
        ],
        callback(name, key) {
            $(".group_setting_section").hide();
            $(`.${CSS.escape(key)}`).show();
            select_tab = key;
        },
    });

    show_settings_for(node);
}

function open_right_panel_empty() {
    $(".group-row.active").removeClass("active");
    user_group_settings_ui.show_user_group_settings_pane.nothing_selected();
    browser_history.update("#groups");
}

export function handle_deleted_group(group_id) {
    if (!hash_util.is_editing_group(group_id)) {
        return;
    }
    open_right_panel_empty();
}

export function open_group_edit_panel_for_row(group_row) {
    const group = get_user_group_for_target(group_row);

    $(".group-row.active").removeClass("active");
    user_group_settings_ui.show_user_group_settings_pane.settings(group);
    $(group_row).addClass("active");
    setup_group_edit_hash(group);
    setup_group_settings(group_row);
}

export function initialize() {
    $("#manage_groups_container").on("click", ".group-row", function (e) {
        if ($(e.target).closest(".check, .user_group_settings_wrapper").length === 0) {
            open_group_edit_panel_for_row(this);
        }
    });

    $("#manage_groups_container").on("click", "#open_group_info_modal", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const user_group_id = get_user_group_id(e.target);
        const user_group = user_groups.get_user_group_from_id(user_group_id);
        const template_data = {
            group_name: user_group.name,
            group_description: user_group.description,
        };
        const change_user_group_info_modal = render_change_user_group_info_modal(template_data);
        dialog_widget.launch({
            html_heading: $t_html(
                {defaultMessage: "Edit {group_name}"},
                {group_name: user_group.name},
            ),
            html_body: change_user_group_info_modal,
            id: "change_group_info_modal",
            on_click: save_group_info,
            post_render() {
                $("#change_group_info_modal .dialog_submit_button")
                    .addClass("save-button")
                    .attr("data-group-id", user_group_id);
            },
        });
    });

    $("#manage_groups_container").on("click", ".group_settings_header .btn-danger", () => {
        const active_group_data = user_group_settings_ui.get_active_data();
        const group_id = active_group_data.id;
        const user_group = user_groups.get_user_group_from_id(group_id);

        if (!user_group || !can_edit(group_id)) {
            return;
        }
        function delete_user_group() {
            channel.del({
                url: "/json/user_groups/" + group_id,
                data: {
                    id: group_id,
                },
                success() {
                    active_group_data.$row.remove();
                },
                error(xhr) {
                    ui_report.error(
                        $t_html({defaultMessage: "Failed"}),
                        xhr,
                        $(".group_change_property_info"),
                    );
                },
            });
        }

        const html_body = render_confirm_delete_user({
            group_name: user_group.name,
        });

        const user_group_name = user_group.name;

        confirm_dialog.launch({
            html_heading: $t_html({defaultMessage: "Delete {user_group_name}?"}, {user_group_name}),
            html_body,
            on_click: delete_user_group,
        });
    });

    function save_group_info(e) {
        e.preventDefault();
        e.stopPropagation();
        const group = get_user_group_for_target(e.currentTarget);

        const url = `/json/user_groups/${group.id}`;
        const data = {};
        const new_name = $("#change_user_group_name").val().trim();
        const new_description = $("#change_user_group_description").val().trim();

        if (new_name === group.name && new_description === group.description) {
            return;
        }
        if (new_name !== group.name) {
            data.name = new_name;
        }
        if (new_description !== group.description) {
            data.description = new_description;
        }

        const $status_element = $(".group_change_property_info");
        dialog_widget.close_modal();
        settings_ui.do_settings_change(channel.patch, url, data, $status_element);
    }
}

"use strict";

const {strict: assert} = require("assert");

const {mock_esm, zrequire} = require("./lib/namespace");
const {run_test} = require("./lib/test");
const $ = require("./lib/zjquery");

const list_widget = mock_esm("../src/list_widget");

const settings_muted_topics = zrequire("settings_muted_topics");
const stream_data = zrequire("stream_data");
const user_topics = zrequire("user_topics");

const noop = () => {};

const frontend = {
    stream_id: 101,
    name: "frontend",
};
stream_data.add_sub(frontend);

run_test("settings", ({override}) => {
    user_topics.update_user_topics(
        frontend.stream_id,
        "js",
        user_topics.all_visibility_policies.MUTED,
        1577836800,
    );
    let populate_list_called = false;
    override(list_widget, "create", ($container, list) => {
        assert.deepEqual(list, [
            {
                date_muted: 1577836800000,
                date_muted_str: "Jan 1, 2020",
                stream: frontend.name,
                stream_id: frontend.stream_id,
                topic: "js",
            },
        ]);
        populate_list_called = true;
    });

    settings_muted_topics.reset();
    assert.equal(settings_muted_topics.loaded, false);

    settings_muted_topics.set_up();
    assert.equal(settings_muted_topics.loaded, true);
    assert.ok(populate_list_called);

    const topic_click_handler = $("body").get_on_handler("click", ".settings-unmute-topic");
    assert.equal(typeof topic_click_handler, "function");

    const event = {
        stopPropagation: noop,
    };

    const $topic_fake_this = $.create("fake.settings-unmute-topic");
    const $topic_tr_html = $('tr[data-topic="js"]');
    $topic_fake_this.closest = (opts) => {
        assert.equal(opts, "tr");
        return $topic_tr_html;
    };

    let topic_data_called = 0;
    $topic_tr_html.attr = (opts) => {
        topic_data_called += 1;
        switch (opts) {
            case "data-stream-id":
                return frontend.stream_id;
            case "data-topic":
                return "js";
            /* istanbul ignore next */
            default:
                throw new Error(`Unknown attribute ${opts}`);
        }
    };

    let unmute_topic_called = false;
    user_topics.set_user_topic_visibility_policy = (stream_id, topic) => {
        assert.equal(stream_id, frontend.stream_id);
        assert.equal(topic, "js");
        unmute_topic_called = true;
    };
    topic_click_handler.call($topic_fake_this, event);
    assert.ok(unmute_topic_called);
    assert.equal(topic_data_called, 2);
});

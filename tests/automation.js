// SPDX-License-Identifier: GPL-2.0-or-later
//
// Tests the extension in a headless GNOME Shell. run-headless.sh passes this
// file as the --automation-script of a GNOME Shell that is isolated from the
// current session.
//
// Prints "ok" or "FAIL" for each check, and GNOME Shell exits with an error
// if a check failed. DND_TEST_SCENARIO selects what to test:
//   cold       enable the extension in the running GNOME Shell and test it
//   startup    the extension was enabled when GNOME Shell started
//   baseline   put the stock UI through the same, to compare the logs with
// Screenshots go into DND_TEST_OUTPUT.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

import {formatTime} from 'resource:///org/gnome/shell/misc/dateUtils.js';
import {ExtensionState} from 'resource:///org/gnome/shell/misc/extensionUtils.js';
import {getLoginManager} from 'resource:///org/gnome/shell/misc/loginManager.js';
import {PopupAnimation} from 'resource:///org/gnome/shell/ui/boxpointer.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import {disableHelperAutoExit, sleep} from 'resource:///org/gnome/shell/ui/scripting.js';

const UUID = GLib.getenv('DND_TEST_UUID');
const SCENARIO = GLib.getenv('DND_TEST_SCENARIO');
const OUTPUT_DIR = GLib.getenv('DND_TEST_OUTPUT');

const TIMER_SOURCE_NAME = '[dnd-in-calendar] Do Not Disturb timer';
const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const PLURAL_DURATIONS = [1, 2, 5, 21, 60, 120, 300, 1260, 1440, 2880, 7200];
const MESSY_DURATIONS = [90, 90, 0, -5];

const TEXTS = GLib.get_language_names()[0].startsWith('ru') ? {
    title: 'Не беспокоить',
    timerButton: 'Не беспокоить на время',
    durations: ['На 30 минут', 'На 1 час', 'На 8 часов', 'На 2 дня',
        'Пока не выключу'],
    pluralDurations: ['На 1 минуту', 'На 2 минуты', 'На 5 минут',
        'На 21 минуту', 'На 1 час', 'На 2 часа', 'На 5 часов', 'На 21 час',
        'На 1 день', 'На 2 дня', 'На 5 дней', 'Пока не выключу'],
    messyDurations: ['На 90 минут', 'Пока не выключу'],
    untilTime: time => `До ${time}`,
    untilTomorrow: time => `До ${time} завтра`,
    untilDate: (date, time) => `До ${date.format('%-d %B')}, ${time}`,
} : {
    title: 'Do Not Disturb',
    timerButton: 'Do Not Disturb for a While',
    durations: ['For 30 Minutes', 'For 1 Hour', 'For 8 Hours', 'For 2 Days',
        'Until I Turn It Off'],
    pluralDurations: ['For 1 Minute', 'For 2 Minutes', 'For 5 Minutes',
        'For 21 Minutes', 'For 1 Hour', 'For 2 Hours', 'For 5 Hours',
        'For 21 Hours', 'For 1 Day', 'For 2 Days', 'For 5 Days',
        'Until I Turn It Off'],
    messyDurations: ['For 90 Minutes', 'Until I Turn It Off'],
    untilTime: time => `Until ${time}`,
    untilTomorrow: time => `Until ${time} tomorrow`,
    untilDate: (date, time) => `Until ${date.format('%B %-d')}, ${time}`,
};

const notificationSettings = new Gio.Settings({
    schema_id: 'org.gnome.desktop.notifications',
});
const interfaceSettings = new Gio.Settings({
    schema_id: 'org.gnome.desktop.interface',
});
let settings = null;

let pointer = null;
let keyboard = null;

let checks = 0;
let failures = 0;
let startupPath = null;

function printDetails(text) {
    for (const line of text.trimEnd().split('\n'))
        print(`#   ${line}`);
}

function check(ok, description) {
    checks++;
    if (!ok)
        failures++;
    print(`${ok ? 'ok' : 'FAIL'} - ${description}`);
    return ok;
}

function checkEqual(actual, expected, description) {
    if (!check(JSON.stringify(actual) === JSON.stringify(expected), description)) {
        printDetails(`expected: ${JSON.stringify(expected)}`);
        printDetails(`actual:   ${JSON.stringify(actual)}`);
    }
}

async function waitFor(condition, timeoutMs = 3000) {
    const end = GLib.get_monotonic_time() + timeoutMs * 1000;
    while (!condition()) {
        if (GLib.get_monotonic_time() > end)
            return false;
        // eslint-disable-next-line no-await-in-loop
        await sleep(50);
    }
    return true;
}

function getUnixTime() {
    return Math.floor(GLib.get_real_time() / GLib.USEC_PER_SEC);
}

function isDoNotDisturb() {
    return !notificationSettings.get_boolean('show-banners');
}

async function setDoNotDisturb(doNotDisturb) {
    notificationSettings.set_boolean('show-banners', !doNotDisturb);
    await sleep(100);
}

async function setColorScheme(scheme) {
    interfaceSettings.set_string('color-scheme', scheme);
    await sleep(500);
}

function addNotifications(count) {
    const source = MessageTray.getSystemSource();
    for (let i = 1; i <= count; i++) {
        source.addNotification(new MessageTray.Notification({
            source,
            title: `Notification ${i}`,
            body: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit',
        }));
    }
}

async function clearNotifications() {
    for (const source of Main.messageTray.getSources())
        [...source.notifications].forEach(n => n.destroy());
    await sleep(500);
}

function setUpInput() {
    const seat = Clutter.get_default_backend().get_default_seat();
    pointer = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
    keyboard = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
}

async function movePointer(x, y) {
    pointer.notify_absolute_motion(GLib.get_monotonic_time(), x, y);
    await sleep(100);
}

// Moves the pointer away, so that nothing is hovered
async function parkPointer() {
    await movePointer(1919, 1079);
}

async function click(actor, xAlign = 0.5) {
    const [x, y] = actor.get_transformed_position();
    const [width, height] = actor.get_transformed_size();
    await movePointer(x + width * xAlign, y + height / 2);
    pointer.notify_button(GLib.get_monotonic_time(),
        Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
    await sleep(50);
    pointer.notify_button(GLib.get_monotonic_time(),
        Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
    await sleep(300);
}

async function pressKey(keyval) {
    keyboard.notify_keyval(GLib.get_monotonic_time(),
        keyval, Clutter.KeyState.PRESSED);
    await sleep(50);
    keyboard.notify_keyval(GLib.get_monotonic_time(),
        keyval, Clutter.KeyState.RELEASED);
    await sleep(300);
}

async function screenshot(name, actor, margin = 0) {
    if (!OUTPUT_DIR)
        return;

    await sleep(300);
    const [x, y] = actor.get_transformed_position();
    const [width, height] = actor.get_transformed_size();
    // GNOME Shell crashes on screenshots of nothing
    if (!check(actor.mapped && width >= 1 && height >= 1,
        `there is something to take a screenshot of: ${name}`))
        return;

    const file = Gio.File.new_for_path(`${OUTPUT_DIR}/${name}.png`);
    const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
    await new Shell.Screenshot().screenshot_area(
        Math.max(Math.floor(x - margin), 0),
        Math.max(Math.floor(y - margin), 0),
        Math.ceil(width + 2 * margin),
        Math.ceil(height + 2 * margin),
        stream);
    stream.close(null);
}

async function openMenu(menu) {
    menu.open(PopupAnimation.NONE);
    await sleep(300);
}

async function closeMenu(menu) {
    menu.close(PopupAnimation.NONE);
    await sleep(300);
}

function getStockUi() {
    const {dateMenu, quickSettings} = Main.panel.statusArea;
    const clearButton = dateMenu._messageList._clearButton;
    return {
        dateMenu,
        quickSettings,
        clock: dateMenu._clockDisplay,
        clearButton,
        controls: clearButton.get_parent(),
        placeholder: dateMenu._messageList._placeholder,
        dndIndicator: quickSettings._doNotDisturb,
    };
}

function describe(actor) {
    return {
        type: actor.constructor.$gtype.name,
        style: actor.style_class ?? null,
        visible: actor.visible,
    };
}

// The parts of the stock UI that the extension changes
function snapshotStockUi() {
    const ui = getStockUi();
    return {
        clockBox: ui.clock.get_parent().get_children().map(describe),
        messageList: ui.controls.get_parent().get_children().map(describe),
        controls: ui.controls.get_children().map(describe),
        clearButtonAlign: ui.clearButton.x_align,
        placeholderOpacity: ui.placeholder.opacity,
        dndIndicator: describe(ui.dndIndicator),
        dndIcons: ui.dndIndicator.get_children().map(describe),
        dndToggles: ui.dndIndicator.quickSettingsItems.map(describe),
    };
}

async function snapshotBothStates() {
    await setDoNotDisturb(false);
    const off = snapshotStockUi();
    await setDoNotDisturb(true);
    const on = snapshotStockUi();
    await setDoNotDisturb(false);
    return {off, on};
}

function findLeftovers() {
    const found = [];
    const visit = actor => {
        if (actor.style_class?.includes('dnd-in-calendar'))
            found.push(describe(actor));
        actor.get_children().forEach(visit);
    };
    visit(global.stage);
    return found;
}

function getExtension() {
    return Main.extensionManager.lookup(UUID);
}

async function setEnabled(enabled) {
    const found = enabled
        ? Main.extensionManager.enableExtension(UUID)
        : Main.extensionManager.disableExtension(UUID);

    const state = enabled ? ExtensionState.ACTIVE : ExtensionState.INACTIVE;
    check(found && await waitFor(() => getExtension()?.state === state),
        enabled ? 'the extension gets enabled' : 'the extension gets disabled');
    await sleep(100);
    return getExtension().stateObj;
}

function getDurationLabels(ext) {
    return ext._durationsBox.get_children().map(item => item.child.text);
}

function isTimerSetFor(ext, seconds) {
    if (!ext._timeoutId)
        return false;

    const source = GLib.MainContext.default().find_source_by_id(ext._timeoutId);
    const remaining =
        (source.get_ready_time() - GLib.get_monotonic_time()) / GLib.USEC_PER_SEC;
    const ok = source.get_name() === TIMER_SOURCE_NAME &&
        Math.abs(remaining - seconds) <= 2;
    if (!ok)
        printDetails(`timer "${source.get_name()}" in ${remaining} s, expected ${seconds} s`);
    return ok;
}

function checkStockUi(stock) {
    check(stock.off.controls.length === 1 &&
        stock.off.controls[0].style.includes('message-list-clear-button'),
    'stock: the message list footer only has Clear');
    check(stock.off.dndToggles.length === 1 && stock.off.dndToggles[0].visible,
        'stock: the quick settings have the Do Not Disturb toggle');
    check(stock.on.dndIndicator.visible && !stock.off.dndIndicator.visible,
        'stock: the quick settings icon shows Do Not Disturb');
}

function checkLayout(ext) {
    const ui = getStockUi();
    const title = ext._labelBox.get_first_child();

    const controls = ui.controls.get_children();
    check(controls.length === 4 &&
        controls[0] === ext._labelBox &&
        controls[1] === ext._switchButton &&
        controls[2] === ext._timerButton &&
        controls[3] === ui.clearButton,
    'the footer has the title, the switch, the timer button and Clear');
    check(ui.clearButton.x_align === Clutter.ActorAlign.END,
        'Clear is on the right');
    check(ext._durationsBox.get_next_sibling() === ui.controls,
        'the durations are right above the footer');

    checkEqual(title.text, TEXTS.title, 'the title is translated');
    check(ext._switchButton.label_actor === title,
        'the switch is labeled by the title');
    checkEqual(ext._timerButton.accessible_name, TEXTS.timerButton,
        'the timer button has a translated name');
    checkEqual(ext._timerButton.child.icon_name, 'preferences-system-time-symbolic',
        'the timer button has a clock icon');

    const clockBox = ui.clock.get_parent().get_children();
    const i = clockBox.indexOf(ui.clock);
    check(clockBox[i - 1] === ext._indicatorPad &&
        clockBox[i + 1] === ext._indicator,
    'the icon is next to the clock, with a pad on the other side');

    check(!ui.dndIndicator.quickSettingsItems[0].visible,
        'the quick settings toggle is hidden');
    check(!ui.dndIndicator.visible && ui.dndIndicator.get_n_children() === 0,
        'the quick settings icon is out of the panel');
}

async function testSettingsSync(ext) {
    const ui = getStockUi();
    for (const on of [true, false, true, false]) {
        // eslint-disable-next-line no-await-in-loop
        await setDoNotDisturb(on);
        const state = on ? 'on' : 'off';
        check(ext._switch.state === on && ext._switchButton.checked === on,
            `the switch follows the setting: ${state}`);
        check(ext._indicator.visible === on && ext._indicatorPad.visible === on,
            `the icon follows the setting: ${state}`);
        check(!ui.dndIndicator.visible,
            `the quick settings icon stays hidden: ${state}`);
    }
}

async function testClockCentered(ext) {
    const ui = getStockUi();
    const getCenter = actor => {
        const [x] = actor.get_transformed_position();
        const [width] = actor.get_transformed_size();
        return x + width / 2;
    };

    await setDoNotDisturb(true);
    await sleep(200);
    const offset = getCenter(ui.clock) - getCenter(ui.clock.get_parent());
    if (!check(ext._indicator.mapped && Math.abs(offset) < 1,
        'the clock stays centered next to the icon'))
        printDetails(`the clock is ${offset} px off the center`);
    await setDoNotDisturb(false);
}

async function testSwitch(ext) {
    const {dateMenu} = getStockUi();
    await setDoNotDisturb(false);
    await openMenu(dateMenu.menu);

    // The handle is on the left while the switch is off
    await click(ext._switch, 0.8);
    check(isDoNotDisturb(), 'clicking the switch turns Do Not Disturb on');
    await click(ext._switch._handle);
    check(!isDoNotDisturb(), 'clicking its handle turns it off');
    await click(ext._switch._handle);
    check(isDoNotDisturb(), 'and on');
    await click(ext._switch, 0.2);
    check(!isDoNotDisturb(), 'clicking the switch turns it off');
    await click(ext._labelBox);
    check(!isDoNotDisturb() && dateMenu.menu.isOpen,
        'clicking the title does nothing');

    ext._switchButton.grab_key_focus();
    await pressKey(Clutter.KEY_space);
    check(isDoNotDisturb(), 'Space turns it on');
    await pressKey(Clutter.KEY_Return);
    check(!isDoNotDisturb(), 'Enter turns it off');

    await closeMenu(dateMenu.menu);
}

async function testDurations(ext) {
    const {dateMenu, placeholder} = getStockUi();
    await setDoNotDisturb(false);
    await openMenu(dateMenu.menu);
    check(!ext._durationsBox.visible, 'the durations are hidden at first');

    await click(ext._timerButton);
    check(ext._timerButton.checked && ext._durationsBox.visible,
        'the timer button shows the durations');
    checkEqual(getDurationLabels(ext), TEXTS.durations,
        'the durations are labeled');
    check(ext._durationsBox.get_children().every(item => item.label_actor === item.child),
        'each duration is labeled by its text, for screen readers');
    check(ext._durationsBox.get_children().every(item => {
        const content = item.get_theme_node().get_content_box(item.get_allocation_box());
        return Math.abs(item.child.allocation.x1 - content.x1) < 1;
    }), 'the durations are aligned to the left');
    const [, timerHeight] = ext._timerButton.get_transformed_size();
    const [, switchHeight] = ext._switch.get_transformed_size();
    if (!check(Math.abs(timerHeight - switchHeight) < 1,
        'the timer button is as tall as the switch'))
        printDetails(`the timer button is ${timerHeight} px, the switch ${switchHeight} px`);
    check(placeholder.visible && placeholder.opacity === 0,
        'they take the place of "No Notifications"');

    let start = getUnixTime();
    await click(ext._durationsBox.get_child_at_index(0));
    let until = settings.get_int64('dnd-until');
    check(isDoNotDisturb() && Math.abs(until - start - 30 * MINUTE) <= 2,
        'picking 30 minutes turns Do Not Disturb on for 30 minutes');
    check(isTimerSetFor(ext, until - getUnixTime()),
        'the timer is set for that time');
    check(!ext._timerButton.checked && !ext._durationsBox.visible,
        'picking a duration hides the durations');
    check(placeholder.opacity === 255, '"No Notifications" is back');
    const time = formatTime(new Date(until * 1000), {timeOnly: true});
    check(ext._subtitle.visible && ext._subtitle.text.includes(time),
        `the subtitle tells when it turns off: "${ext._subtitle.text}"`);

    await click(ext._switch, 0.2);
    check(!isDoNotDisturb() && settings.get_int64('dnd-until') === 0 &&
        !ext._timeoutId,
    'turning it off by hand cancels the timer');
    check(!ext._subtitle.visible, 'and hides the subtitle');

    await click(ext._timerButton);
    const items = ext._durationsBox.get_children();
    await click(items[items.length - 1]);
    check(isDoNotDisturb() && settings.get_int64('dnd-until') === 0 &&
        !ext._timeoutId,
    '"until I turn it off" turns it on without a timer');
    check(!ext._subtitle.visible, 'and without the subtitle');

    await click(ext._timerButton);
    start = getUnixTime();
    await click(ext._durationsBox.get_child_at_index(1));
    until = settings.get_int64('dnd-until');
    check(isDoNotDisturb() && Math.abs(until - start - HOUR) <= 2 &&
        isTimerSetFor(ext, until - getUnixTime()),
    'picking an hour while it is on sets the timer');

    await click(ext._timerButton);
    await closeMenu(dateMenu.menu);
    check(!ext._timerButton.checked && !ext._durationsBox.visible,
        'closing the menu hides the durations');
    await openMenu(dateMenu.menu);
    check(!ext._durationsBox.visible, 'they stay hidden when it opens again');
    await closeMenu(dateMenu.menu);

    await setDoNotDisturb(false);
}

async function testCustomDurations(ext) {
    settings.set_value('durations', new GLib.Variant('ai', PLURAL_DURATIONS));
    await sleep(100);
    checkEqual(getDurationLabels(ext), TEXTS.pluralDurations,
        'the durations follow the settings, in the right plural forms');

    settings.set_value('durations', new GLib.Variant('ai', MESSY_DURATIONS));
    await sleep(100);
    checkEqual(getDurationLabels(ext), TEXTS.messyDurations,
        'repeated and invalid durations are left out');

    settings.reset('durations');
    await sleep(100);
    checkEqual(getDurationLabels(ext), TEXTS.durations,
        'the default durations come back');
}

async function testTimer(ext) {
    await setDoNotDisturb(true);
    settings.set_int64('dnd-until', getUnixTime() + 2);
    check(await waitFor(() => !isDoNotDisturb(), 5000),
        'the timer turns Do Not Disturb off');
    check(settings.get_int64('dnd-until') === 0 && !ext._timeoutId,
        'and is gone then');

    await setDoNotDisturb(true);
    settings.set_int64('dnd-until', getUnixTime() - MINUTE);
    check(await waitFor(() => !isDoNotDisturb(), 1000),
        'a time in the past turns it off at once');

    settings.set_int64('dnd-until', getUnixTime() + 10 * MINUTE);
    check(await waitFor(() => settings.get_int64('dnd-until') === 0, 1000),
        'a timer is dropped while Do Not Disturb is off');

    await setDoNotDisturb(true);
    settings.set_int64('dnd-until', getUnixTime() + 3 * DAY);
    await sleep(100);
    check(isTimerSetFor(ext, DAY),
        'a timer of several days is set a day at a time');

    settings.set_int64('dnd-until', getUnixTime() + 10 * MINUTE);
    await sleep(100);
    const timeoutId = ext._timeoutId;
    // Only the resume: the screen shield locks the screen before suspend
    getLoginManager().emit('prepare-for-sleep', false);
    check(ext._timeoutId !== timeoutId && isTimerSetFor(ext, 10 * MINUTE),
        'the timer is set again after resuming from suspend');

    await setDoNotDisturb(false);
}

async function testSubtitle(ext) {
    const now = GLib.DateTime.new_now_local();
    const soon = now.add_minutes(2);
    const tomorrow = now.add_days(1);
    const later = now.add_days(3);
    const tomorrowMorning = GLib.DateTime.new_local(tomorrow.get_year(),
        tomorrow.get_month(), tomorrow.get_day_of_month(), 9, 0, 0);
    const laterEvening = GLib.DateTime.new_local(later.get_year(),
        later.get_month(), later.get_day_of_month(), 18, 30, 0);

    const formatEnd = date =>
        formatTime(new Date(date.to_unix() * 1000), {timeOnly: true});
    const isToday = soon.get_day_of_year() === now.get_day_of_year();

    await setDoNotDisturb(true);
    for (const [date, expected] of [
        [soon, isToday
            ? TEXTS.untilTime(formatEnd(soon))
            : TEXTS.untilTomorrow(formatEnd(soon))],
        [tomorrowMorning, TEXTS.untilTomorrow(formatEnd(tomorrowMorning))],
        [laterEvening, TEXTS.untilDate(laterEvening, formatEnd(laterEvening))],
    ]) {
        settings.set_int64('dnd-until', date.to_unix());
        // eslint-disable-next-line no-await-in-loop
        await sleep(100);
        check(ext._subtitle.visible && ext._subtitle.text === expected,
            `the subtitle reads "${expected}"`);
        if (ext._subtitle.text !== expected)
            printDetails(`actual: "${ext._subtitle.text}"`);
    }
    await setDoNotDisturb(false);
    check(!ext._subtitle.visible, 'the subtitle is hidden with Do Not Disturb off');
}

async function testKeyboard(ext) {
    const {dateMenu} = getStockUi();
    await setDoNotDisturb(false);
    await parkPointer();
    await openMenu(dateMenu.menu);

    ext._timerButton.grab_key_focus();
    await pressKey(Clutter.KEY_space);
    const [first, second] = ext._durationsBox.get_children();
    check(ext._durationsBox.visible && global.stage.key_focus === first,
        'Space on the timer button shows the durations and focuses the first');
    check(first.has_style_pseudo_class('selected'),
        'the focused duration is highlighted');
    await screenshot('keyboard', dateMenu.menu.actor);

    await pressKey(Clutter.KEY_Down);
    check(global.stage.key_focus === second &&
        second.has_style_pseudo_class('selected') &&
        !first.has_style_pseudo_class('selected'),
    'Down moves to the next duration');

    const start = getUnixTime();
    await pressKey(Clutter.KEY_Return);
    check(isDoNotDisturb() &&
        Math.abs(settings.get_int64('dnd-until') - start - HOUR) <= 2,
    'Enter picks the duration');
    check(!ext._durationsBox.visible &&
        global.stage.key_focus === ext._timerButton,
    'the focus goes back to the timer button');

    await pressKey(Clutter.KEY_space);
    check(global.stage.key_focus === first, 'the durations get the focus again');
    await click(ext._timerButton);
    check(!ext._durationsBox.visible &&
        global.stage.key_focus === ext._timerButton,
    'hiding the durations with the pointer moves the focus out of them');

    await pressKey(Clutter.KEY_space);
    await pressKey(Clutter.KEY_Escape);
    await sleep(500);
    check(!dateMenu.menu.isOpen && !ext._timerButton.checked,
        'Escape closes the menu and hides the durations');

    await setDoNotDisturb(false);
}

async function testLockScreen(ext) {
    Main.sessionMode.pushMode('unlock-dialog');
    await sleep(1000);
    check(getExtension().state === ExtensionState.ACTIVE,
        'the extension stays enabled while the screen is locked');

    await setDoNotDisturb(true);
    settings.set_int64('dnd-until', getUnixTime() + 2);
    check(await waitFor(() => !isDoNotDisturb(), 5000),
        'the timer turns Do Not Disturb off while the screen is locked');

    Main.sessionMode.popMode('unlock-dialog');
    await sleep(1000);
    check(getExtension().state === ExtensionState.ACTIVE &&
        ext._switchButton.get_parent() === getStockUi().controls,
    'everything is in place after unlocking');
}

async function testEnableWithTimer() {
    await setDoNotDisturb(true);
    settings.set_int64('dnd-until', getUnixTime() + 10 * MINUTE);
    let ext = await setEnabled(false);
    check(!ext._timeoutId && isDoNotDisturb(),
        'disabling stops the timer, but leaves Do Not Disturb on');

    ext = await setEnabled(true);
    check(isDoNotDisturb() && isTimerSetFor(ext, 10 * MINUTE),
        'enabling sets the timer again');

    await setEnabled(false);
    settings.set_int64('dnd-until', getUnixTime() - 10);
    await sleep(100);
    ext = await setEnabled(true);
    check(await waitFor(() => !isDoNotDisturb(), 1000),
        'a timer that ran out while disabled turns Do Not Disturb off on enable');
    return ext;
}

async function takeScreenshots(ext, scheme) {
    const {dateMenu, quickSettings} = getStockUi();
    await setColorScheme(scheme);
    await parkPointer();

    await setDoNotDisturb(false);
    await openMenu(dateMenu.menu);
    await screenshot(`menu-${scheme}`, dateMenu.menu.actor);
    ext._timerButton.checked = true;
    await screenshot(`durations-empty-${scheme}`, dateMenu.menu.actor);
    ext._timerButton.checked = false;

    await setDoNotDisturb(true);
    settings.set_int64('dnd-until', getUnixTime() + 30 * MINUTE);
    addNotifications(3);
    await screenshot(`timer-${scheme}`, dateMenu.menu.actor);
    ext._timerButton.checked = true;
    await screenshot(`durations-${scheme}`, dateMenu.menu.actor);
    ext._timerButton.checked = false;
    ext._switchButton.grab_key_focus();
    await screenshot(`focus-${scheme}`, dateMenu.menu.actor);
    await closeMenu(dateMenu.menu);
    await screenshot(`panel-${scheme}`, dateMenu, 40);

    await openMenu(quickSettings.menu);
    await screenshot(`quick-settings-${scheme}`, quickSettings.menu._boxPointer);
    await closeMenu(quickSettings.menu);

    await clearNotifications();
    await setDoNotDisturb(false);
}

async function testDisable(stock) {
    for (const on of [false, true]) {
        const state = on ? 'on' : 'off';
        /* eslint-disable no-await-in-loop */
        await setDoNotDisturb(on);
        await setEnabled(false);
        checkEqual(snapshotStockUi(), stock[state],
            `disabling with Do Not Disturb ${state} restores the stock UI`);
        checkEqual(findLeftovers(), [], 'nothing of the extension is left');

        await setDoNotDisturb(!on);
        checkEqual(snapshotStockUi(), stock[on ? 'off' : 'on'],
            'the restored quick settings follow the setting');
        await setEnabled(true);
        /* eslint-enable no-await-in-loop */
    }
    await setDoNotDisturb(false);
}

async function testCycles(stock) {
    let ext;
    for (let i = 0; i < 3; i++) {
        /* eslint-disable no-await-in-loop */
        await setEnabled(false);
        ext = await setEnabled(true);
        /* eslint-enable no-await-in-loop */
    }
    checkLayout(ext);
    await testSettingsSync(ext);

    await setEnabled(false);
    checkEqual(snapshotStockUi(), stock.off,
        'the stock UI is intact after enabling and disabling a few times');
    checkEqual(findLeftovers(), [], 'nothing of the extension is left');
}

async function testCold() {
    // GNOME Shell loads the extensions after it has started
    check(await waitFor(() => getExtension()?.state === ExtensionState.INITIALIZED),
        'the extension is loaded');

    const stock = await snapshotBothStates();
    checkStockUi(stock);

    let ext = await setEnabled(true);
    settings = ext.getSettings();
    checkLayout(ext);

    // Before Do Not Disturb is turned on or off, which changes what Clutter
    // does with the icon of the quick settings when it is put back
    await setEnabled(false);
    checkEqual(snapshotStockUi(), stock.off,
        'disabling it right away restores the stock UI');
    ext = await setEnabled(true);

    await testSettingsSync(ext);
    await testClockCentered(ext);
    await testSwitch(ext);
    await testDurations(ext);
    await testCustomDurations(ext);
    await testTimer(ext);
    await testSubtitle(ext);
    await testKeyboard(ext);
    await testLockScreen(ext);
    ext = await testEnableWithTimer();
    for (const scheme of ['prefer-light', 'prefer-dark'])
        // eslint-disable-next-line no-await-in-loop
        await takeScreenshots(ext, scheme);
    await testDisable(stock);
    await testCycles(stock);
}

async function testStartup() {
    // GNOME Shell loads the extensions after it has started
    check(await waitFor(() => getExtension()?.state === ExtensionState.ACTIVE),
        'the extension is enabled at startup');
    print(`# on startup, ${startupPath ?? 'the extension was enabled before the test was loaded'}`);

    let ext = getExtension().stateObj;
    settings = ext.getSettings();
    check(!ext._quickSettingsBox &&
        ext._dndIndicator === getStockUi().dndIndicator,
    'it found the quick settings toggle');
    checkLayout(ext);

    // Before Do Not Disturb is turned on or off, which changes what Clutter
    // does with the icon of the quick settings when it is put back
    await setEnabled(false);
    const {dndIndicator} = getStockUi();
    check(dndIndicator.quickSettingsItems[0].visible && !dndIndicator.visible,
        'disabling it brings back the quick settings toggle, but not the icon');
    const stock = await snapshotBothStates();
    checkStockUi(stock);

    ext = await setEnabled(true);
    checkLayout(ext);
    await testSettingsSync(ext);
    await testDisable(stock);
    await testCycles(stock);
}

// Puts the stock UI through what the other scenarios do with the extension,
// in the same order
async function testBaseline() {
    const {dateMenu, quickSettings} = getStockUi();
    const stock = await snapshotBothStates();
    checkStockUi(stock);

    getLoginManager().emit('prepare-for-sleep', false);
    await sleep(100);
    Main.sessionMode.pushMode('unlock-dialog');
    await sleep(1000);
    await setDoNotDisturb(true);
    await setDoNotDisturb(false);
    Main.sessionMode.popMode('unlock-dialog');
    await sleep(1000);
    await snapshotBothStates();

    // Disabling the extension with Do Not Disturb on also disables and enables
    // the extensions that were enabled after it, such as those enabled again
    // on unlocking the screen. Locking and unlocking it does the same.
    await setDoNotDisturb(true);
    Main.sessionMode.pushMode('unlock-dialog');
    await sleep(1000);
    Main.sessionMode.popMode('unlock-dialog');
    await sleep(1000);
    await setDoNotDisturb(false);

    for (const scheme of ['prefer-light', 'prefer-dark']) {
        /* eslint-disable no-await-in-loop */
        await setColorScheme(scheme);
        await parkPointer();
        await setDoNotDisturb(true);
        addNotifications(3);
        await openMenu(dateMenu.menu);
        await screenshot(`stock-menu-${scheme}`, dateMenu.menu.actor);
        await closeMenu(dateMenu.menu);
        await screenshot(`stock-panel-${scheme}`, dateMenu, 40);
        await openMenu(quickSettings.menu);
        await screenshot(`stock-quick-settings-${scheme}`, quickSettings.menu._boxPointer);
        await closeMenu(quickSettings.menu);
        await clearNotifications();
        await setDoNotDisturb(false);
        /* eslint-enable no-await-in-loop */
    }
}

// Notes whether the extension, enabled at startup, had to wait for the quick
// settings to be populated
function noteStartupPath(extension) {
    if (startupPath || extension?.state !== ExtensionState.ACTIVE)
        return;

    startupPath = extension.stateObj._quickSettingsBox
        ? 'the extension waited for the quick settings'
        : 'the quick settings were ready for the extension';
}

export function init() {
    if (SCENARIO !== 'startup')
        return;

    noteStartupPath(getExtension());
    Main.extensionManager.connect('extension-state-changed',
        (_manager, extension) => {
            if (extension.uuid === UUID)
                noteStartupPath(extension);
        });
}

export async function run() {
    // The helper exits by itself when idle, and the tests don't use it
    await disableHelperAutoExit();

    setUpInput();
    // The first move of a new pointer lands at the top of the screen
    await movePointer(960, 540);
    await parkPointer();
    // Such as the one about the screen lock, which needs GDM
    await clearNotifications();

    check(await waitFor(() => Main.panel.statusArea.quickSettings._doNotDisturb),
        'the quick settings are populated');

    const tests = {
        cold: testCold,
        startup: testStartup,
        baseline: testBaseline,
    };
    try {
        await tests[SCENARIO]();
    } catch (error) {
        check(false, `the test runs to the end: ${error}`);
        printDetails(error.stack);
    }

    print(`# ${checks} checks, ${failures} failed`);
    if (failures)
        throw new Error(`${failures} of ${checks} checks failed`);
}

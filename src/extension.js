// SPDX-License-Identifier: GPL-2.0-or-later
//
// Brings the "Do Not Disturb" switch back to the bottom of the date menu and
// its icon next to the clock, the way earlier GNOME versions had them, and
// removes the toggle from the quick settings. Do Not Disturb can also be
// turned on for a while, after which it turns itself off.

import Atk from 'gi://Atk';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as Gettext from 'gettext';

import {Extension, gettext as _, ngettext} from 'resource:///org/gnome/shell/extensions/extension.js';
import {formatTime} from 'resource:///org/gnome/shell/misc/dateUtils.js';
import {getLoginManager} from 'resource:///org/gnome/shell/misc/loginManager.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const SHOW_BANNERS_KEY = 'show-banners';
const DND_UNTIL_KEY = 'dnd-until';
const DURATIONS_KEY = 'durations';

const MINUTES_PER_DAY = 24 * 60;

// GLib timeouts overflow after ~49 days, so long timers are re-armed daily
const MAX_TIMEOUT_SECONDS = 24 * 60 * 60;

function getUnixTime() {
    return Math.floor(GLib.get_real_time() / GLib.USEC_PER_SEC);
}

function isSameDay(a, b) {
    return a.get_year() === b.get_year() &&
        a.get_day_of_year() === b.get_day_of_year();
}

function formatDuration(minutes) {
    if (minutes % MINUTES_PER_DAY === 0) {
        const days = minutes / MINUTES_PER_DAY;
        return ngettext('For %d Day', 'For %d Days', days).format(days);
    }

    if (minutes % 60 === 0) {
        const hours = minutes / 60;
        return ngettext('For %d Hour', 'For %d Hours', hours).format(hours);
    }

    return ngettext('For %d Minute', 'For %d Minutes', minutes).format(minutes);
}

function formatEndTime(unixTime) {
    const now = GLib.DateTime.new_now_local();
    const end = GLib.DateTime.new_from_unix_local(unixTime);
    const time = formatTime(new Date(unixTime * 1000), {timeOnly: true});

    if (isSameDay(end, now)) {
        /* Translators: when Do Not Disturb turns off, e.g. "Until 18:30" */
        return _('Until %s').format(time);
    }

    if (isSameDay(end, now.add_days(1))) {
        /* Translators: when Do Not Disturb turns off,
           e.g. "Until 9:00 tomorrow" */
        return _('Until %s tomorrow').format(time);
    }

    /* Translators: date format used in "Until %1$s, %2$s", see `man date` */
    const date = end.format(_('%B %-d'));
    /* Translators: when Do Not Disturb turns off, %1$s is the date and
       %2$s is the time, e.g. "Until October 15, 18:30" */
    return _('Until %1$s, %2$s').format(date, time);
}

export default class DndInCalendarExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._notificationSettings = new Gio.Settings({
            schema_id: 'org.gnome.desktop.notifications',
        });

        const {dateMenu, quickSettings} = Main.panel.statusArea;
        this._addIndicator(dateMenu);
        this._addControls(dateMenu);
        this._hideQuickSettingsToggle(quickSettings);

        this._notificationSettings.connectObject(
            `changed::${SHOW_BANNERS_KEY}`, () => this._syncTimer(), this);
        this._settings.connectObject(
            `changed::${DND_UNTIL_KEY}`, () => this._syncTimer(),
            `changed::${DURATIONS_KEY}`, () => this._syncDurations(), this);
        // Timeouts don't count the time spent in suspend
        getLoginManager().connectObject('prepare-for-sleep',
            (_manager, aboutToSuspend) => {
                if (!aboutToSuspend)
                    this._syncTimer();
            }, this);

        this._syncTimer();
    }

    disable() {
        // The extension keeps running in the unlock-dialog session mode to
        // turn Do Not Disturb off on time while the screen is locked: until
        // then, notifications don't wake up the screen. It adds nothing to the
        // lock screen and handles no keyboard events there, as the date menu
        // with its controls is hidden.
        getLoginManager().disconnectObject(this);
        this._settings.disconnectObject(this);
        this._notificationSettings.disconnectObject(this);
        this._removeTimeout();

        this._restoreQuickSettingsToggle();
        this._removeControls();
        this._removeIndicator();

        this._notificationSettings = null;
        this._settings = null;
    }

    _addIndicator(dateMenu) {
        const clock = dateMenu._clockDisplay;
        const box = clock.get_parent();

        // Takes the place of the notification indicator, which hides itself
        // while Do Not Disturb is on
        this._indicator = new St.Icon({
            style_class: 'messages-indicator',
            icon_name: 'notifications-disabled-symbolic',
            y_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._notificationSettings.bind(SHOW_BANNERS_KEY,
            this._indicator, 'visible',
            Gio.SettingsBindFlags.GET | Gio.SettingsBindFlags.INVERT_BOOLEAN);

        // Keeps the clock centered, like the pad of the stock indicator
        this._indicatorPad = new St.Widget();
        this._indicator.bind_property('visible',
            this._indicatorPad, 'visible',
            GObject.BindingFlags.SYNC_CREATE);
        this._indicatorPad.add_constraint(new Clutter.BindConstraint({
            source: this._indicator,
            coordinate: Clutter.BindCoordinate.SIZE,
        }));

        box.insert_child_below(this._indicatorPad, clock);
        box.insert_child_above(this._indicator, clock);
    }

    _removeIndicator() {
        Gio.Settings.unbind(this._indicator, 'visible');
        this._indicatorPad.destroy();
        this._indicator.destroy();

        this._indicatorPad = null;
        this._indicator = null;
    }

    _addControls(dateMenu) {
        this._dateMenu = dateMenu;
        this._clearButton = dateMenu._messageList._clearButton;
        this._placeholder = dateMenu._messageList._placeholder;
        const controls = this._clearButton.get_parent();

        const title = new St.Label({
            text: Gettext.dgettext('gnome-shell', 'Do Not Disturb'),
        });
        this._subtitle = new St.Label({
            style_class: 'dnd-in-calendar-subtitle',
            visible: false,
        });
        this._labelBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._labelBox.add_child(title);
        this._labelBox.add_child(this._subtitle);

        this._switch = new PopupMenu.Switch(
            !this._notificationSettings.get_boolean(SHOW_BANNERS_KEY));
        this._notificationSettings.bind(SHOW_BANNERS_KEY,
            this._switch, 'state',
            Gio.SettingsBindFlags.INVERT_BOOLEAN);

        // The switch itself only reacts to dragging its handle, the button
        // makes all of it clickable and focusable
        this._switchButton = new St.Button({
            style_class: 'dnd-in-calendar-switch',
            accessible_role: Atk.Role.TOGGLE_BUTTON,
            can_focus: true,
            toggle_mode: true,
            child: this._switch,
            label_actor: title,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._switch.bind_property('state',
            this._switchButton, 'checked',
            GObject.BindingFlags.BIDIRECTIONAL | GObject.BindingFlags.SYNC_CREATE);

        this._timerButton = new St.Button({
            style_class: 'icon-button flat dnd-in-calendar-timer',
            accessible_name: _('Do Not Disturb for a While'),
            can_focus: true,
            toggle_mode: true,
            child: new St.Icon({icon_name: 'preferences-system-time-symbolic'}),
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._timerButton.connectObject('clicked', () => {
            // Opened from the keyboard, continue in the list
            if (this._timerButton.checked && this._timerButton.has_key_focus())
                this._durationsBox.get_first_child()?.grab_key_focus();
        }, 'notify::checked', () => {
            // The durations take the place of "No Notifications". Hiding it
            // would hide Clear, as that follows its visibility.
            this._placeholder.opacity = this._timerButton.checked ? 0 : 255;

            const focus = global.stage.get_key_focus();
            if (!this._timerButton.checked && this._dateMenu.menu.isOpen &&
                focus && this._durationsBox.contains(focus))
                this._timerButton.grab_key_focus();
        }, this);

        this._durationsBox = new St.BoxLayout({
            style_class: 'quick-toggle-menu dnd-in-calendar-durations',
            orientation: Clutter.Orientation.VERTICAL,
        });
        this._timerButton.bind_property('checked',
            this._durationsBox, 'visible',
            GObject.BindingFlags.SYNC_CREATE);
        this._syncDurations();

        controls.insert_child_at_index(this._labelBox, 0);
        controls.insert_child_at_index(this._switchButton, 1);
        controls.insert_child_at_index(this._timerButton, 2);
        controls.get_parent().insert_child_below(this._durationsBox, controls);

        // "Clear" goes back to the right
        this._clearButtonAlign = this._clearButton.x_align;
        this._clearButton.x_align = Clutter.ActorAlign.END;

        dateMenu.menu.connectObject('open-state-changed', (_menu, isOpen) => {
            if (isOpen)
                this._syncSubtitle();
            else
                this._timerButton.checked = false;
        }, this);
    }

    _removeControls() {
        this._dateMenu.menu.disconnectObject(this);
        this._timerButton.disconnectObject(this);
        Gio.Settings.unbind(this._switch, 'state');

        // Children before their parents, which would destroy them already
        this._durationsBox.destroy();
        this._timerButton.destroy();
        this._switch.destroy();
        this._switchButton.destroy();
        this._subtitle.destroy();
        this._labelBox.destroy();
        this._clearButton.x_align = this._clearButtonAlign;
        this._placeholder.opacity = 255;

        this._durationsBox = null;
        this._timerButton = null;
        this._switchButton = null;
        this._switch = null;
        this._labelBox = null;
        this._subtitle = null;
        this._placeholder = null;
        this._clearButton = null;
        this._dateMenu = null;
    }

    _syncDurations() {
        this._durationsBox.destroy_all_children();

        const durations = this._settings.get_value(DURATIONS_KEY).deepUnpack();
        for (const minutes of new Set(durations.filter(m => m > 0)))
            this._addDurationItem(formatDuration(minutes), minutes * 60);
        this._addDurationItem(_('Until I Turn It Off'), 0);
    }

    _addDurationItem(text, seconds) {
        // Without expanding, the button centers it
        const label = new St.Label({
            text,
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
        });
        const item = new St.Button({
            style_class: 'popup-menu-item',
            can_focus: true,
            child: label,
            label_actor: label,
        });
        // Highlighted like a menu item when focused from the keyboard
        item.connect('key-focus-in',
            () => item.add_style_pseudo_class('selected'));
        item.connect('key-focus-out',
            () => item.remove_style_pseudo_class('selected'));
        item.connect('clicked', () => this._turnOn(seconds));
        this._durationsBox.add_child(item);
    }

    _turnOn(seconds) {
        this._timerButton.checked = false;
        // On first: a timer set while Do Not Disturb is off gets dropped
        this._notificationSettings.set_boolean(SHOW_BANNERS_KEY, false);
        this._settings.set_int64(DND_UNTIL_KEY,
            seconds ? getUnixTime() + seconds : 0);
    }

    _syncTimer() {
        this._removeTimeout();

        const doNotDisturb =
            !this._notificationSettings.get_boolean(SHOW_BANNERS_KEY);
        const until = this._settings.get_int64(DND_UNTIL_KEY);
        const remaining = until - getUnixTime();

        if (until && !doNotDisturb) {
            // Turned off before the time was up
            this._settings.set_int64(DND_UNTIL_KEY, 0);
        } else if (until && remaining <= 0) {
            this._notificationSettings.set_boolean(SHOW_BANNERS_KEY, true);
        } else if (until) {
            this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT,
                Math.min(remaining, MAX_TIMEOUT_SECONDS), () => {
                    this._timeoutId = 0;
                    this._syncTimer();
                    return GLib.SOURCE_REMOVE;
                });
            GLib.Source.set_name_by_id(this._timeoutId,
                '[dnd-in-calendar] Do Not Disturb timer');
        }

        this._syncSubtitle();
    }

    _removeTimeout() {
        if (this._timeoutId)
            GLib.source_remove(this._timeoutId);
        this._timeoutId = 0;
    }

    _syncSubtitle() {
        const doNotDisturb =
            !this._notificationSettings.get_boolean(SHOW_BANNERS_KEY);
        const until = this._settings.get_int64(DND_UNTIL_KEY);

        this._subtitle.visible = doNotDisturb && until > 0;
        if (this._subtitle.visible)
            this._subtitle.text = formatEndTime(until);
    }

    _hideQuickSettingsToggle(quickSettings) {
        if (quickSettings._doNotDisturb) {
            this._hideDndIndicator(quickSettings._doNotDisturb);
            return;
        }

        // Quick settings are populated asynchronously on startup
        this._quickSettingsBox = quickSettings._indicators;
        this._quickSettingsBox.connectObject('child-added', (_box, child) => {
            if (child !== quickSettings._doNotDisturb)
                return;

            this._quickSettingsBox.disconnectObject(this);
            this._quickSettingsBox = null;
            this._hideDndIndicator(child);
        }, this);
    }

    _hideDndIndicator(indicator) {
        this._dndIndicator = indicator;

        // On startup the toggle isn't in the menu yet, and an actor without a
        // parent isn't visible. Hiding it now keeps it hidden in the menu.
        this._dndToggles = [...indicator.quickSettingsItems];
        this._dndToggles.forEach(t => t.hide());

        // The icon's visibility follows the toggle, so take it out instead
        this._dndIcons = indicator.get_children();
        this._dndIcons.forEach(icon => indicator.remove_child(icon));
        indicator.hide();
    }

    _restoreQuickSettingsToggle() {
        this._quickSettingsBox?.disconnectObject(this);
        this._quickSettingsBox = null;

        if (!this._dndIndicator)
            return;

        this._dndIcons.forEach(icon => {
            // Adding an actor shows it, unless it was hidden without a parent
            const {visible} = icon;
            this._dndIndicator.add_child(icon);
            icon.visible = visible;
        });
        this._dndIndicator.visible = this._dndIcons.some(icon => icon.visible);
        this._dndToggles.forEach(t => t.show());

        this._dndIndicator = null;
        this._dndIcons = null;
        this._dndToggles = null;
    }
}

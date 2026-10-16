<div align="center">

# Do Not Disturb in Calendar

**The Do Not Disturb switch back in the date menu, now with a timer.**

A GNOME Shell extension that puts Do Not Disturb back at the bottom of the date
menu, as in earlier GNOME versions, and lets you mute notifications for a while,
like a chat.

[![GNOME Shell 50](https://img.shields.io/badge/GNOME_Shell-50-4A86CF?logo=gnome&logoColor=white)](https://extensions.gnome.org/extension/11247/do-not-disturb-in-calendar/)
[![Tested on Ubuntu 26.04 LTS](https://img.shields.io/badge/tested_on-Ubuntu_26.04_LTS-E95420?logo=ubuntu&logoColor=white)](#requirements)
[![License: GPL-2.0-or-later](https://img.shields.io/badge/license-GPL--2.0--or--later-blue)](LICENSE)

<a href="https://extensions.gnome.org/extension/11247/do-not-disturb-in-calendar/">
  <img src="https://raw.githubusercontent.com/andyholmes/gnome-shell-extensions-badge/master/get-it-on-ego.svg" alt="Get it on GNOME Extensions" height="100">
</a>

**English** · [Русский](README.ru.md)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshot-dark.png">
  <img src="docs/screenshot.png" alt="The date menu with the Do Not Disturb switch and the list of durations" width="640">
</picture>

</div>

## Features

- 🎚️ **Back in the date menu.** The Do Not Disturb switch sits at the bottom of
  the date menu, next to **Clear**.
- ⏱️ **For a while.** Mute notifications for 30 minutes, an hour, 8 hours,
  2 days or until you turn them back on. The menu tells when Do Not Disturb
  ends, such as "Until 18:30", and it turns off on time even while the screen
  is locked.
- 🔕 **Icon next to the clock** while Do Not Disturb is on.
- 🧹 **Tidy quick settings.** The Do Not Disturb toggle and its icon are gone
  from there.
- ⌨️ **Works with the keyboard.**
- 🔄 **In sync with GNOME.** It follows the `show-banners` setting, so Do Not
  Disturb can still be changed in other ways, such as in Settings.
- 🌍 **In English and Russian.**

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/panel-dark.png">
    <img src="docs/panel.png" alt="The Do Not Disturb icon next to the clock in the top bar" width="259">
  </picture>
</p>

## Usage

1. Click the clock in the top bar to open the date menu.
2. Turn on **Do Not Disturb** to mute notifications until you turn it off.
3. Or click the clock button next to the switch and choose for how long.

Turning Do Not Disturb off by hand cancels the timer.

## Installation

### From GNOME Extensions (recommended)

Switch it on at its
[page on extensions.gnome.org](https://extensions.gnome.org/extension/11247/do-not-disturb-in-calendar/).

> [!TIP]
> The site needs the GNOME Shell integration add-on in the browser. Without it,
> search for *Do Not Disturb in Calendar* in Extension Manager and install it
> there.

### From the source code

```sh
git clone https://github.com/Mist3s/dnd-in-calendar.git
cd dnd-in-calendar
./install.sh
```

The script packs the extension and installs it for the current user, into
`~/.local/share/gnome-shell/extensions/`. It needs `zip`, `glib-compile-schemas`
and `gnome-extensions`. To compile the translations, it uses `msgfmt` if
gettext is installed, and Python otherwise.

> [!NOTE]
> On Wayland, GNOME Shell finds a new extension only after you log out and back
> in. Then switch it on in Extensions, or with
> `gnome-extensions enable dnd-in-calendar@mist3s.github.io`.

A packed extension, a `.shell-extension.zip` file, such as the one attached to
[a release](https://github.com/Mist3s/dnd-in-calendar/releases), is installed with
`gnome-extensions install --force dnd-in-calendar@mist3s.github.io.shell-extension.zip`.

### Requirements

GNOME Shell 50. Tested on Ubuntu 26.04 LTS, in the Ubuntu and GNOME sessions,
on Wayland.

## Settings

The durations in the menu are a setting, in minutes. The default ones are
`[30, 60, 480, 2880]`:

```sh
gsettings --schemadir ~/.local/share/gnome-shell/extensions/dnd-in-calendar@mist3s.github.io/schemas \
    set org.gnome.shell.extensions.dnd-in-calendar durations '[15, 60, 240, 1440]'
```

`reset` instead of `set … '[…]'` brings back the default ones.

## Switching off and removing

```sh
gnome-extensions disable dnd-in-calendar@mist3s.github.io
```

brings the stock date menu and quick settings back at once, without logging
out. Do Not Disturb stays as it was, and while the extension is off, no timer
turns it off. To remove the extension, run `./install.sh uninstall` or
`gnome-extensions uninstall dnd-in-calendar@mist3s.github.io`.

<details>
<summary><b>How it works</b></summary>

- Do Not Disturb is on while `show-banners` of `org.gnome.desktop.notifications`
  is off. The switch and the icon next to the clock follow this setting.
- When Do Not Disturb is turned on for a while, the extension saves the time to
  turn it off in its `dnd-until` setting and sets a timer for it. The timer is
  set again after resuming from suspend and on logging in. If the time has
  passed in the meantime, Do Not Disturb is turned off at once.
- The extension keeps running while the screen is locked, only to turn Do Not
  Disturb off on time. It adds nothing to the lock screen.
- It changes internal parts of GNOME Shell: the date menu and the quick
  settings. These change between GNOME versions, so each new version needs
  checking, and the extension is only marked as compatible with the versions
  it was tested on.

</details>

<details>
<summary><b>Troubleshooting</b></summary>

Errors of the extension name its UUID in the log of GNOME Shell:

```sh
journalctl -b -o cat /usr/bin/gnome-shell | grep -A10 dnd-in-calendar
```

On Ubuntu, the log may have errors of Ubuntu Dock after Do Not Disturb is
turned off, such as `remoteModel is undefined` and `this._area is undefined`.
They come from Ubuntu Dock (`ubuntu-dock@ubuntu.com`) and happen without this
extension too.

Found a bug? [Open an issue](https://github.com/Mist3s/dnd-in-calendar/issues).

</details>

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to help, and
[CHANGELOG.md](CHANGELOG.md) for what changed between versions.

```
src/          the extension, as it is packed
po/           the translations
tests/        tests in headless GNOME Shells
install.sh    packs and installs the extension
```

### Tests

```sh
tests/run-headless.sh
```

starts GNOME Shells without a display, isolated from your session: each has its
own D-Bus buses, home directory and settings. The tests click and type through
the date menu, check the timer, the lock screen, switching the extension on and
off, at startup and in a running GNOME Shell, in the GNOME and Ubuntu sessions,
in English and Russian. A test fails on warnings of the extension in the log of
GNOME Shell. The logs and screenshots go into `build/tests/`.

### Packing for extensions.gnome.org

```sh
./install.sh pack
```

creates `build/dnd-in-calendar@mist3s.github.io.shell-extension.zip`, to upload
at [extensions.gnome.org/upload](https://extensions.gnome.org/upload/).

### Translations

New translations are welcome. The template is `po/dnd-in-calendar.pot`. To add
a language, copy it to `po/LANGUAGE.po`, such as `po/de.po`, fill in the header
and translate it. `install.sh` compiles all the `po/*.po` files. "Do Not
Disturb" itself comes from the translations of GNOME Shell.

<details>
<summary>Updating the template after changing the strings in the code</summary>

```sh
xgettext --from-code=UTF-8 --language=JavaScript --add-comments=Translators: \
    --keyword --keyword=_ --keyword=ngettext:1,2 \
    --package-name=dnd-in-calendar \
    --msgid-bugs-address=https://github.com/Mist3s/dnd-in-calendar/issues \
    --output=po/dnd-in-calendar.pot src/extension.js
for po in po/*.po; do msgmerge --update --backup=none "$po" po/dnd-in-calendar.pot; done
```

</details>

## Code of conduct

This project follows the [GNOME Code of Conduct](https://conduct.gnome.org/).

## License

[GPL-2.0-or-later](LICENSE)

# Contributing

Thanks for helping to make Do Not Disturb in Calendar better! Everyone taking
part follows the [GNOME Code of Conduct](https://conduct.gnome.org/).

## Bugs and ideas

[Open an issue](https://github.com/Mist3s/dnd-in-calendar/issues/new/choose).
For a bug, the form asks for your GNOME Shell version, distribution and the log
of GNOME Shell: these usually tell what went wrong.

## Translations

Copy `po/dnd-in-calendar.pot` to `po/LANGUAGE.po`, such as `po/de.po`, fill in
the header, translate it and open a pull request. See
[Translations](README.md#translations) in the README.

## Code

1. Install the extension from your copy with `./install.sh`. On Wayland, log
   out and back in for GNOME Shell to load a new version.
2. Keep the style of the surrounding code, which follows the code of GNOME
   Shell.
3. Run the tests with `tests/run-headless.sh`. They need GNOME Shell 50 and
   run headless, without touching your session.
4. If you changed the strings in the code, update the template and the
   translations, as the README tells.

The extension follows the
[review guidelines of extensions.gnome.org](https://gjs.guide/extensions/review-guidelines/review-guidelines.html):
everything it creates or connects in `enable()` is destroyed or disconnected in
`disable()`.

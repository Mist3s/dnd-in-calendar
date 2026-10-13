#!/usr/bin/env bash
# Packs the extension and installs it for the current user.
#
#   ./install.sh             pack and install it
#   ./install.sh pack        only pack it, e.g. to upload to extensions.gnome.org
#   ./install.sh uninstall   disable and remove it

set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SRC=$ROOT/src

metadata() {
    sed -n "s/^ *\"$1\": *\"\([^\"]*\)\".*/\1/p" "$SRC/metadata.json"
}

UUID=$(metadata uuid)
DOMAIN=$(metadata gettext-domain)
ZIP=$ROOT/build/$UUID.shell-extension.zip

# The zip holds the sources and the compiled translations. The settings schema
# is compiled on installation.
pack() {
    local po mo
    STAGE=$(mktemp -d)
    trap 'rm -rf "$STAGE"' EXIT

    mkdir -p "$STAGE/schemas"
    cp "$SRC/metadata.json" "$SRC/extension.js" "$SRC/stylesheet.css" "$STAGE/"
    cp "$SRC"/schemas/*.gschema.xml "$STAGE/schemas/"
    glib-compile-schemas --strict --dry-run "$STAGE/schemas"

    for po in "$ROOT"/po/*.po; do
        mo=$STAGE/locale/$(basename "$po" .po)/LC_MESSAGES/$DOMAIN.mo
        mkdir -p "$(dirname "$mo")"
        if command -v msgfmt >/dev/null; then
            msgfmt --check -o "$mo" "$po"
        else
            python3 -I "$ROOT/tools/msgfmt.py" "$po" "$mo"
        fi
    done

    mkdir -p "$ROOT/build"
    rm -f "$ZIP"
    (cd "$STAGE" && zip -qrX "$ZIP" .)
    echo "Packed $ZIP"
}

case ${1:-install} in
install)
    pack
    gnome-extensions install --force "$ZIP"
    echo "Installed $UUID"
    echo "Log out and back in for GNOME Shell to load it, then enable it:"
    echo "    gnome-extensions enable $UUID"
    ;;
pack)
    pack
    ;;
uninstall)
    # Also unloads it from GNOME Shell, if it is loaded there
    gnome-extensions uninstall "$UUID" 2>/dev/null ||
        rm -rf "${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"
    echo "Removed $UUID"
    ;;
*)
    echo "Usage: $0 [install | pack | uninstall]" >&2
    exit 2
    ;;
esac

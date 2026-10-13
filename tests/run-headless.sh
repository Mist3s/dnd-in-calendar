#!/usr/bin/env bash
# Tests the extension in headless GNOME Shells, isolated from the current
# session: each test has its own D-Bus buses, home directory and settings.
#
#   tests/run-headless.sh [TEST...]
#
# Runs the given tests, or all of them. The logs and the screenshots go into
# build/tests/TEST/. The "stock" tests run GNOME Shell without the extension.
# Each of the other tests fails if its log has warnings caused by the
# extension, or other warnings that the log of the stock test for the same
# session mode and language doesn't have. Warnings caused by other extensions
# are only listed.

set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
OUT=$ROOT/build/tests
UUID=$(sed -n 's/^ *"uuid": *"\([^"]*\)".*/\1/p' "$ROOT/src/metadata.json")
ZIP=$ROOT/build/$UUID.shell-extension.zip

# test, scenario (see automation.js), session mode, language, stock test
TESTS=(
    'stock-user-en      baseline user   C.UTF-8     -'
    'user-en            cold     user   C.UTF-8     stock-user-en'
    'user-en-startup    startup  user   C.UTF-8     stock-user-en'
    'stock-ubuntu-ru    baseline ubuntu ru_RU.UTF-8 -'
    'ubuntu-ru          cold     ubuntu ru_RU.UTF-8 stock-ubuntu-ru'
    'ubuntu-ru-startup  startup  ubuntu ru_RU.UTF-8 stock-ubuntu-ru'
)

# The warnings and errors of GNOME Shell in a log, one per line and without
# what changes from run to run. A warning caused by the JS code of an
# extension ends with "[in UUID]", going by the first frame of its backtrace.
problems() {
    awk '
        function flush() {
            if (problem != "")
                print problem (where != "" ? " [in " where "]" : "")
            problem = where = ""
        }
        /\(gnome-shell:[0-9]+\): .*(WARNING|CRITICAL) \*\*|JS (ERROR|WARNING)/ {
            flush()
            problem = $0
            lookahead = 8
            next
        }
        problem != "" && lookahead-- > 0 {
            if (match($0, /\/gnome-shell\/extensions\/[^\/]+\//)) {
                where = substr($0, RSTART + 24, RLENGTH - 25)
                flush()
            } else if ($0 ~ /^#0 |@(file|resource):/) {
                flush()
            }
            next
        }
        { flush() }
        END { flush() }
    ' "$1" |
        sed -E 's/\(([a-z-]+):[0-9]+\)/(\1)/g
                s/[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]+: //
                s/0x[0-9a-fA-F]+/0x?/g
                s/PID [0-9]+/PID ?/g
                s/:1\.[0-9]+/:1.?/g' |
        LC_ALL=C sort -u
}

run_test() {
    local name=$1 scenario=$2 mode=$3 lang=$4 stock=$5
    local dir=$OUT/$name log=$OUT/$name/shell.log
    local desktop=GNOME runtime start status=0 passed failed others

    rm -rf "$dir"
    # Desktop Icons NG in the Ubuntu session needs the desktop folder
    mkdir -p "$dir/home/Desktop" "$dir/home/.local/share/applications" \
        "$dir/screenshots"
    # Without an app to update extensions, GNOME Shell doesn't look for updates
    # on extensions.gnome.org. The tests stay offline, and the first start
    # doesn't wait for the answer before loading the extensions.
    for app in org.gnome.Extensions com.mattjakeman.ExtensionManager; do
        printf '[Desktop Entry]\nType=Application\nName=%s\nExec=false\nHidden=true\n' \
            "$app" >"$dir/home/.local/share/applications/$app.desktop"
    done
    if [ "$mode" = ubuntu ]; then
        desktop=ubuntu:GNOME
    fi

    # It holds sockets, so its path has to be short
    runtime=$(mktemp -d -t dnd-XXXXXX)
    start=$SECONDS
    env -i PATH=/usr/bin:/bin \
        HOME="$dir/home" \
        XDG_CONFIG_HOME="$dir/home/.config" \
        XDG_DATA_HOME="$dir/home/.local/share" \
        XDG_CACHE_HOME="$dir/home/.cache" \
        XDG_STATE_HOME="$dir/home/.local/state" \
        XDG_RUNTIME_DIR="$runtime" \
        XDG_CURRENT_DESKTOP="$desktop" \
        LANG="$lang" \
        SHELL_DEBUG=backtrace-warnings \
        DND_TEST_OUTPUT="$dir/screenshots" \
        timeout 300 dbus-run-session -- \
        "$ROOT/tests/session.sh" "$ZIP" "$mode" "$scenario" \
        >"$log" 2>&1 || status=$?
    rm -rf "$runtime"

    passed=$(grep -c '^ok - ' "$log" || true)
    failed=$(grep -c '^FAIL - ' "$log" || true)
    printf '%-18s %3d ok, %d failed, exit status %d, %d s\n' \
        "$name" "$passed" "$failed" "$status" $((SECONDS - start))
    grep -A20 '^FAIL - ' "$log" | grep -E '^(FAIL - |#)' | sed 's/^/    /' || true

    if [ "$status" -ne 0 ] || [ "$failed" -ne 0 ] || [ "$passed" -eq 0 ]; then
        FAILED+=("$name")
    fi

    if [ "$stock" != - ]; then
        compare_warnings "$name" "$stock"
    fi

    others=$(problems "$log" | grep -a ' \[in ' | grep -avF "[in $UUID]" || true)
    if [ -n "$others" ]; then
        echo "    warnings of other extensions:"
        printf '%s\n' "$others" | sed 's/^/      /'
    fi
}

# Fails the test if its log has warnings of the extension, or others that the
# log of the stock test doesn't have
compare_warnings() {
    local name=$1 stock=$2 log=$OUT/$1/shell.log mentions ours new

    if [ ! -f "$OUT/$stock/shell.log" ]; then
        echo "    no log of $stock to compare the warnings with"
        return
    fi

    # Such as "Extension … had error", but not the stack traces of others
    mentions=$(grep -aF "$UUID" "$log" |
        grep -avE '^(ok|FAIL) - |^#|@(file|resource):' || true)
    ours=$(problems "$log" | grep -aF "[in $UUID]" || true)
    new=$(LC_ALL=C comm -13 \
        <(problems "$OUT/$stock/shell.log" | grep -av ' \[in ' || true) \
        <(problems "$log" | grep -av ' \[in ' || true))

    if [ -n "$ours$mentions$new" ]; then
        echo "    warnings of the extension, or that $stock doesn't have:"
        printf '%s\n' "$ours" "$mentions" "$new" | sed '/^$/d; s/^/      /'
        FAILED+=("$name (warnings)")
    else
        echo "    no warnings of the extension or that $stock doesn't have"
    fi
}

"$ROOT/install.sh" pack

FAILED=()
for test in "${TESTS[@]}"; do
    read -r name scenario mode lang stock <<<"$test"
    if [ $# -eq 0 ] || [[ " $* " = *" $name "* ]]; then
        run_test "$name" "$scenario" "$mode" "$lang" "$stock"
    fi
done

echo "Logs and screenshots are in $OUT"
if [ ${#FAILED[@]} -ne 0 ]; then
    echo "Failed: ${FAILED[*]}"
    exit 1
fi

# Do Not Disturb in Calendar

Расширение GNOME Shell, которое возвращает переключатель «Не беспокоить» вниз
меню с датой и календарём и показывает его значок рядом с часами, как в
прежних версиях GNOME. Из быстрых настроек переключатель убирается.

«Не беспокоить» можно включить и на время, как при отключении уведомлений чата:
на 30 минут, час, 8 часов или 2 дня. Потом режим выключается сам, даже если
экран заблокирован.

![Меню с датой: переключатель «Не беспокоить» и список длительностей](docs/screenshot-ru.png)

[English version](README.md)

## Возможности

- Переключатель **Не беспокоить** внизу меню с датой, рядом с кнопкой
  **Очистить**.
- Значок «Не беспокоить» рядом с часами, пока режим включён.
- Кнопка с часами рядом с переключателем включает режим на время. Пока время
  не вышло, в меню написано, когда режим выключится, например «До 18:30».
  Если выключить режим вручную, таймер отменяется.
- В быстрых настройках нет переключателя и значка «Не беспокоить».
- Всем можно управлять с клавиатуры.
- Режим хранится в настройке GNOME `show-banners`
  (`org.gnome.desktop.notifications`), поэтому его по-прежнему можно менять и
  другими способами, например в «Параметрах».
- Английский и русский языки.

## Требования

GNOME Shell 50. Проверено на Ubuntu 26.04 LTS, в сеансах Ubuntu и GNOME,
на Wayland.

## Установка

### С extensions.gnome.org

Найдите *Do Not Disturb in Calendar* на
[extensions.gnome.org](https://extensions.gnome.org/) или в Extension Manager
и включите его.

### Из исходного кода

```sh
git clone https://github.com/Mist3s/dnd-in-calendar.git
cd dnd-in-calendar
./install.sh
```

Скрипт собирает расширение и устанавливает его для текущего пользователя в
`~/.local/share/gnome-shell/extensions/`. Ему нужны `zip`,
`glib-compile-schemas` и `gnome-extensions`. Переводы он компилирует с помощью
`msgfmt`, если установлен gettext, а иначе с помощью Python.

На Wayland GNOME Shell видит новое расширение только после того, как вы выйдете
из сеанса и войдёте снова. Затем включите его в «Расширениях» или командой:

```sh
gnome-extensions enable dnd-in-calendar@mist3s.github.io
```

Собранное расширение, файл `.shell-extension.zip`, устанавливается командой
`gnome-extensions install --force dnd-in-calendar@mist3s.github.io.shell-extension.zip`.

## Выключение и удаление

```sh
gnome-extensions disable dnd-in-calendar@mist3s.github.io
```

сразу возвращает обычные меню с датой и быстрые настройки, без выхода из
сеанса. «Не беспокоить» остаётся как было, и пока расширение выключено, таймер
режим не выключит. Удалить расширение:

```sh
./install.sh uninstall
```

или `gnome-extensions uninstall dnd-in-calendar@mist3s.github.io`.

## Настройки

Длительности в меню задаются настройкой, в минутах:

```sh
gsettings --schemadir ~/.local/share/gnome-shell/extensions/dnd-in-calendar@mist3s.github.io/schemas \
    set org.gnome.shell.extensions.dnd-in-calendar durations '[15, 60, 240, 1440]'
```

Если вместо `set … '[…]'` написать `reset`, вернутся длительности по умолчанию.

## Как это работает

- «Не беспокоить» включён, пока выключена настройка `show-banners` в
  `org.gnome.desktop.notifications`. Переключатель и значок рядом с часами
  следуют за ней.
- Когда режим включают на время, расширение сохраняет время выключения в своей
  настройке `dnd-until` и ставит на него таймер. После выхода из ждущего режима
  и при входе в сеанс таймер ставится заново. Если время за это время уже
  прошло, режим выключается сразу.
- Расширение продолжает работать, пока экран заблокирован, только чтобы
  выключить режим вовремя. На экран блокировки оно ничего не добавляет.
- Оно меняет внутренние части GNOME Shell: меню с датой и быстрые настройки.
  Они меняются от версии к версии GNOME, поэтому каждую новую версию нужно
  проверять, и расширение помечено совместимым только с теми версиями, на
  которых оно проверено.

## Проверка журнала

Ошибки расширения в журнале GNOME Shell содержат его UUID:

```sh
journalctl -b -o cat /usr/bin/gnome-shell | grep -A10 dnd-in-calendar
```

В Ubuntu после выключения «Не беспокоить» в журнале бывают ошибки Ubuntu Dock,
например `remoteModel is undefined` и `this._area is undefined`. Это ошибки
самого Ubuntu Dock (`ubuntu-dock@ubuntu.com`), они бывают и без этого
расширения.

## Разработка

- `src/`: само расширение в том виде, в каком оно упаковывается
- `po/`: переводы
- `install.sh`: сборка и установка
- `tests/`: тесты в GNOME Shell без экрана

### Тесты

```sh
tests/run-headless.sh
```

запускает GNOME Shell без экрана, отдельно от вашего сеанса: у каждого теста
свои шины D-Bus, домашний каталог и настройки. Тесты щёлкают мышью и нажимают
клавиши в меню с датой, проверяют таймер, экран блокировки, включение и
выключение расширения — при запуске GNOME Shell и в уже работающем, в сеансах
GNOME и Ubuntu, на английском и русском. Тест не проходит, если в журнале
GNOME Shell есть предупреждения расширения. Журналы и снимки экрана
сохраняются в `build/tests/`.

### Сборка для extensions.gnome.org

```sh
./install.sh pack
```

создаёт `build/dnd-in-calendar@mist3s.github.io.shell-extension.zip` для
загрузки на [extensions.gnome.org/upload](https://extensions.gnome.org/upload/).

### Переводы

Шаблон — `po/dnd-in-calendar.pot`. Чтобы добавить язык, скопируйте его в
`po/ЯЗЫК.po`, например `po/de.po`, заполните заголовок и переведите строки.
`install.sh` компилирует все файлы `po/*.po`. Сама надпись «Не беспокоить»
берётся из переводов GNOME Shell.

Если строки в коде изменились, обновите шаблон и переводы с помощью gettext:

```sh
xgettext --from-code=UTF-8 --language=JavaScript --add-comments=Translators: \
    --keyword --keyword=_ --keyword=ngettext:1,2 \
    --package-name=dnd-in-calendar \
    --msgid-bugs-address=https://github.com/Mist3s/dnd-in-calendar/issues \
    --output=po/dnd-in-calendar.pot src/extension.js
for po in po/*.po; do msgmerge --update --backup=none "$po" po/dnd-in-calendar.pot; done
```

## Правила поведения

Проект следует [Кодексу поведения GNOME](https://conduct.gnome.org/).

## Лицензия

GPL-2.0-or-later, см. [LICENSE](LICENSE).

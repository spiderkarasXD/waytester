# WayTester

Лаунчер Minecraft: Java Edition в стиле Material 3 + frosted glass.

- **Загрузчики:** Vanilla, Fabric, Quilt, Forge (включая 1.12.2 и старше), NeoForge (включая 1.20.1), OptiFine — отдельно или поверх Forge/Fabric.
- **Контент:** поиск и установка модов, модпаков, ресурспаков и шейдеров с Modrinth и CurseForge, зависимости ставятся сами, проверка обновлений модов.
- **Импорт сборок:** Prism Launcher / MultiMC, CurseForge App, Modrinth App, ATLauncher, GDLauncher, TLauncher / `.minecraft`, файлы `.mrpack` и CurseForge `.zip`. Сборки на компьютере находятся автоматически; файл или папку можно просто перетащить в окно.
- **Аккаунты:** только лицензия Microsoft. Вход через окно Microsoft прямо в лаунчере, без настройки Client ID.
- **Скины:** 3D-примерка (skinview3d), библиотека скинов, импорт по нику, Classic/Slim, смена плаща.
- **Java** нужной версии (8 / 17 / 21 / 25…) скачивается автоматически — от Mojang, а на Linux ARM от Adoptium.
- Экспорт сборки в `.mrpack`, консоль игры, миры, настройки памяти/JVM для каждой сборки.
- Windows, Linux (AppImage / deb / tar.gz), macOS.

## CurseForge

CurseForge работает из коробки: ключ API встраивается в сборку из файла `src/main/curseforge.json` (`{ "apiKey": "…" }`). Файл не хранится в репозитории — перед сборкой создайте его со своим ключом с <https://console.curseforge.com>. Пользователь может указать свой ключ в **Настройки → Платформы**. Modrinth работает без ключа.

## Разработка

```bash
npm install
npm start
```

Сборка:

```bash
npm run dist:win     # NSIS-установщик + portable .exe
npm run dist:linux   # AppImage + tar.gz (AppImage/deb собираются на Linux или в GitHub Actions)
```

`.github/workflows/build.yml` собирает Windows, Linux (AppImage, deb, tar.gz) и macOS по тегу `v*`.

Данные лаунчера: `%APPDATA%\WayTester` (Windows), `~/.local/share/waytester` (Linux), `~/Library/Application Support/WayTester` (macOS). Переопределяется переменной `WAYTESTER_HOME`.

## Дисклеймер

WayTester — неофициальный лаунчер, не одобрен Mojang или Microsoft и не связан с ними. Нужна лицензионная Minecraft: Java Edition. Лицензия кода: MIT.

## Устройство

```
src/main/        процесс Electron
  minecraft.js   манифест версий, библиотеки, ассеты, аргументы запуска
  loaders.js     Fabric / Quilt / Forge / NeoForge / OptiFine
  java.js        автоматические рантаймы Java
  instances.js   сборки, запуск, моды, обновления, экспорт
  platforms.js   Modrinth + CurseForge
  modpacks.js    .mrpack, CurseForge zip, импорт из других лаунчеров
  accounts.js    вход Microsoft (окно login.live.com → Xbox Live → Minecraft)
  skins.js       скины и плащи
src/renderer/    интерфейс (vanilla JS, без сборщика)
```

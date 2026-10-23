# WayTester

Лаунчер Minecraft: Java Edition в стиле Material 3 + frosted glass.

- **Загрузчики:** Vanilla, Fabric, Quilt, Forge (включая 1.12.2 и старше), NeoForge (включая 1.20.1), OptiFine — отдельно или поверх Forge/Fabric.
- **Контент:** поиск и установка модов, модпаков, ресурспаков и шейдеров с Modrinth и CurseForge, зависимости ставятся сами, проверка обновлений модов.
- **Импорт сборок:** Prism Launcher / MultiMC, CurseForge App, Modrinth App, ATLauncher, GDLauncher, TLauncher / `.minecraft`, файлы `.mrpack` и CurseForge `.zip`. Сборки на компьютере находятся автоматически; файл или папку можно просто перетащить в окно.
- **Аккаунты:** только лицензия Microsoft. Вход как в Prism — браузер открывается сам, а рядом QR-код и код для входа с телефона.
- **Скины:** 3D-примерка (skinview3d), библиотека скинов, импорт по нику, Classic/Slim, смена плаща.
- **Java** нужной версии (8 / 17 / 21 / 25…) скачивается автоматически — от Mojang, а на Linux ARM от Adoptium.
- Экспорт сборки в `.mrpack`, консоль игры, миры, настройки памяти/JVM для каждой сборки.
- Windows, Linux (AppImage / deb / tar.gz), macOS.

## Microsoft Client ID (один раз, для автора сборки)

Prism работает «из коробки», потому что у него есть свой Client ID, одобренный Mojang; использовать чужой ID нельзя. Для WayTester нужно один раз зарегистрировать свой:

1. [portal.azure.com](https://portal.azure.com) → **App registrations** → **New registration**.
   - Supported account types: **Personal Microsoft accounts only**.
   - Redirect URI: платформа **Public client/native (mobile & desktop)**, адрес `http://localhost`.
2. В **Authentication** включите **Allow public client flows**.
3. Отправьте ID приложения на одобрение Minecraft: <https://aka.ms/mce-reviewappid> (без этого Minecraft API ответит 403).
4. Впишите ID в `src/main/oauth.json` (`"clientId": "…"`) или передайте переменной `WAYTESTER_CLIENT_ID` при сборке — после этого пользователям ничего настраивать не нужно.

Продвинутые пользователи могут переопределить ID в **Настройки → Аккаунты**.

## CurseForge

Поиск по CurseForge требует бесплатного API-ключа: <https://console.curseforge.com> → **Настройки → Платформы**. Modrinth работает без ключа.

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
  accounts.js    вход Microsoft (PKCE + loopback, device code + QR)
  skins.js       скины и плащи
src/renderer/    интерфейс (vanilla JS, без сборщика)
```

# Иллюстрации к гайду Telegram Serverless

Созданы 10 октября 2026 встроенным инструментом image_gen (режим built-in). Исходные чужие изображения не использовались. Это авторские иллюстрации интерфейса, а не скриншоты аккаунта, одобрения заявки или выполнения команд. Название Garden Lab условное. Настоящий скриншот бота хранится отдельно: `../telegram-start.png`.

## serverless-flow.png и serverless-flow.svg

Авторская схема одного полива: пользователь → обработчик в Telegram → SQLite → ответ. Создана в SVG, PNG экспортирован из SVG через sharp. Генеративная модель для этой схемы не использовалась. Оба формата включены в комплект.

## serverless-access.png

Итог: получение раннего доступа через BotFather. Для финального варианта исправлено название строки в первом экране и удалена декоративная надпись на горшке.

### Исходный промпт

```text
Use case: ui-mockup.
Asset type: original editorial illustration for a Russian technical article, wide landscape canvas.
Primary request: create a polished readable three-panel onboarding illustration explaining how to request Telegram Serverless beta access in BotFather. This is an illustrative reconstruction, not a real screenshot, and must explicitly say so in the image. Invent your own clean composition; do not imitate an existing article or image.
Style: restrained modern editorial UI illustration, flat straight-on views, subtle paper texture and soft shadows, pale warm background, dark navy type, Telegram blue buttons and small green sprout accents connecting to a garden experiment. Three evenly spaced rounded mobile-like interface cards connected by slim arrows. Plenty of clear space, large text, no tiny filler UI.
Top title, exact Russian: "Как запросить доступ"
Small visible subtitle, exact: "Иллюстрация интерфейса • не скриншот"
Card 1 has numbered heading "1. BotFather", a simple fictional bot row titled "Garden Lab", blue button "Open".
Card 2 has numbered heading "2. Выберите бота", row "Garden Lab", blue highlighted menu item "Serverless".
Card 3 has numbered heading "3. Подайте заявку", title "Serverless", one blue button with exact English "Get access to Serverless", small Russian caption "Дождитесь приглашения".
Constraints: render all specified text correctly and sharply. Do not add other text, fake tokens, usernames, timestamps, personal information, account verification marks, claims of guaranteed access, prices, or approval messages. No watermark or website logo. The three steps must be sequential, with exactly one clear primary button in each card. Make the composition visibly an authored educational illustration, not a pasted chat screenshot.
```

### Финальная правка

```text
Edit the preceding three-panel BotFather access illustration. Preserve its composition, typography, colors, all other text, and the explicit label "Иллюстрация интерфейса • не скриншот". Make exactly two corrections: in the FIRST panel only, replace the bot row text "Garden Lab" next to the man avatar and Open button with "BotFather"; remove the small slogan on the plant pot and leave the pot plain. Keep "Garden Lab" in the second and third panels as the fictional selected bot. Do not add anything else.
```

## serverless-first-deploy.png

Итог: включение Serverless, CLI Access, создание проекта, вход и загрузка кода. Команды миграции выделены отдельно. Иллюстрация не содержит токенов или результатов выполнения.

### Финальный промпт

```text
Use case: ui-mockup.
Asset type: original wide editorial onboarding illustration for a Russian article about Telegram Serverless.
Primary request: show the next phase after an early-access invitation: enabling Serverless for a test bot, getting CLI access, and deploying a starter project from a local terminal. This must visibly be a designed educational mockup, not a real execution record or actual screenshot.
Style/medium: polished flat editorial UI with subtle watercolor paper texture, warm cream background, navy text, bright blue controls and small green garden sprout accents. Straight-on, crisp readable typography, soft shadows.
Composition: a narrower bot-settings card on the left, a right-pointing arrow, a much wider dark navy terminal card on the right, a separate light callout below the terminal. Keep terminal lines large enough to read. No decorative tiny text.
Top title exact: "От приглашения до запуска"
Subtitle exact: "Иллюстрация • не скриншот"
Left card text: "BotFather", "Garden Lab", "Serverless" beside an enabled blue toggle, then a blue button "CLI Access". No token value and no fake approval message.
Right terminal heading exact: "Локальный терминал"
Render these exact commands as four separate lines of monospaced text, without prompts or output:
"npm create @tgcloud/bot my_serverless_lab"
"cd my_serverless_lab"
"npx tgcloud login"
"npx tgcloud push"
Lower callout heading exact: "Миграции базы выполняются отдельно"
Render two exact monospaced lines in the callout:
"npx tgcloud migrate --dry-run"
"npx tgcloud migrate --safe"
Constraints: exact spelling of all commands is critical. Avoid logos, usernames, credentials, timestamps, success logs, invented performance claims, prices, and additional slogans. No actual secret, even partially. Small plants may frame the cards without covering text.
```

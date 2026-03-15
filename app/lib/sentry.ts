if (String(process.type) === 'main') {
    const { init } = require('@sentry/electron/dist/main')
    const { app } = require('electron')

    const SENTRY_DSN = 'https://4717a0a7ee0b4429bd3a0f06c3d7eec3@sentry.io/181876'

    if (!process.env.TABBY_DEV) {
        init({
            dsn: SENTRY_DSN,
            release: app.getVersion(),
            integrations (integrations) {
                return integrations.filter(integration => integration.name !== 'Breadcrumbs')
            },
        })
    }
}

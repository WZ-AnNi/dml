import { createConnection, createServer, createTypeScriptProject, loadTsdkByPath } from '@volar/language-server/node'
import { create as createTypeScriptServices } from 'volar-service-typescript'
import { tsdmlLanguagePlugin } from './languagePlugin'

const connection = createConnection()
const server = createServer(connection)

connection.listen()

connection.onInitialize(params => {
	const tsdk = loadTsdkByPath(params.initializationOptions.typescript.tsdk, params.locale)
	return server.initialize(
		params,
		createTypeScriptProject(tsdk.typescript, tsdk.diagnosticMessages, () => ({
			languagePlugins: [tsdmlLanguagePlugin],
		})),
		createTypeScriptServices(tsdk.typescript),
	)
})

connection.onInitialized(server.initialized)

connection.onShutdown(server.shutdown)

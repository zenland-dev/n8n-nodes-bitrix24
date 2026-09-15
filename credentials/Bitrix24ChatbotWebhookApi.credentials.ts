import type { Icon, ICredentialTestRequest, ICredentialType, INodeProperties } from 'n8n-workflow';

import {
	BOT_TOKEN_MAX_LENGTH,
	pinnedHttpRequestDomains,
	portalAddressProperties,
	portalHostExpression,
	requestsPerSecondProperty,
	webhookTokenExpression,
} from './portalAddress';

const TEST_HOST = portalHostExpression('$credentials.subdomain', '$credentials.domain');
const TEST_TOKEN = webhookTokenExpression('$credentials.webhookToken');

/**
 * An inbound webhook plus the token of a chatbot registered through it.
 *
 * Through a webhook, every `imbot.v2` call names its bot by `botToken`, a string the
 * integrator makes up at registration. Whoever holds it acts as the bot, so it is a
 * secret like the webhook code and lives here rather than in a workflow parameter,
 * where it would travel with every exported or shared workflow.
 */
export class Bitrix24ChatbotWebhookApi implements ICredentialType {
	name = 'bitrix24ChatbotWebhookApi';

	displayName = 'Bitrix24 Chatbot Webhook API';

	documentationUrl = 'https://apidocs.bitrix24.com/api-reference/chat-bots/chat-bots-v2/index.html';

	icon: Icon = {
		light: 'file:../icons/bitrix24.svg',
		dark: 'file:../icons/bitrix24.dark.svg',
	};

	properties: INodeProperties[] = [
		{
			displayName:
				'Create an inbound webhook in Bitrix24 under Developer resources → Other → Inbound webhook with the imbot permission (and im, if the bot should also read the webhook user\'s events), and copy the part of its URL after /rest/ into Webhook Token. Then make up a Bot Token: the bot is registered with it and every later call names the bot by it.',
			name: 'setupNotice',
			type: 'notice',
			default: '',
		},
		...portalAddressProperties,
		{
			displayName: 'Webhook Token',
			name: 'webhookToken',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			placeholder: '1/abcdef0123456789',
			description:
				'User ID and secret code from the inbound webhook URL, as <ID>/<code>. Pasting the whole URL works too: only the part after /rest/ is kept.',
		},
		{
			displayName: 'Bot Token',
			name: 'botToken',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description: `A secret of your own, up to ${BOT_TOKEN_MAX_LENGTH} characters, for example 32 random letters and digits from a password generator. Bot → Register ties the new bot to it, and Bitrix24 lets only calls with this token act as that bot. Keep it once a bot is registered: a different token cannot reach the bot any more.`,
		},
		requestsPerSecondProperty,
		pinnedHttpRequestDomains,
	];

	// Revision.get is the one imbot.v2 method that needs no bot, so it checks the portal,
	// the webhook and its imbot permission. The bot token itself cannot be checked before a
	// bot is registered with it: Bot.list answers an empty list for any token.
	test: ICredentialTestRequest = {
		request: {
			baseURL: `=https://{{ ${TEST_HOST} }}/rest/{{ ${TEST_TOKEN} }}`,
			url: '/imbot.v2.Revision.get.json',
			method: 'POST',
		},
	};
}
